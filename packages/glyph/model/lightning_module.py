import torch
import torch.nn.functional as F
import torchmetrics
import wandb
from lightning import LightningModule
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR, LinearLR, SequentialLR
from torchvision.utils import make_grid

from glyph.model.architectures.segformer import Segformer


class SmoothedCombinedLoss(torch.nn.Module):
    def __init__(self, dice_weight=0.5, bce_weight=0.5, label_smoothing=0.1):
        super(SmoothedCombinedLoss, self).__init__()
        self.dice_weight = dice_weight
        self.bce_weight = bce_weight
        self.label_smoothing = label_smoothing

    def _smooth_targets(self, targets):
        if self.label_smoothing > 0:
            return targets * (1 - self.label_smoothing) + (1 - targets) * self.label_smoothing
        return targets

    def forward(self, preds, targets):
        smoothed_targets = self._smooth_targets(targets)
        intersection = (preds * smoothed_targets).sum()
        dice_inputs_sum = preds.sum()
        dice_targets_sum = smoothed_targets.sum()
        dice_coef = (2. * intersection + 1e-8) / (dice_inputs_sum + dice_targets_sum + 1e-8)
        dice = 1 - dice_coef

        with torch.cuda.amp.autocast(enabled=False):
            preds_float32 = preds.float()
            smoothed_targets_float32 = smoothed_targets.float()
            bce = F.binary_cross_entropy(preds_float32, smoothed_targets_float32)

        return self.dice_weight * dice + self.bce_weight * bce


class SF_Module(LightningModule):
    """Expects a cleaned config in dict format"""

    def __init__(self, **kwargs):
        super().__init__()

        # Set all attributes from the config as instance variables
        for key, value in kwargs.items():
            setattr(self, key, value)

        self.save_hyperparameters()
        self.model = Segformer(**kwargs)

        bce_weight = getattr(self, 'bce_weight', 0.5)
        # expects prediction probabilities
        self.loss_function = SmoothedCombinedLoss(bce_weight=bce_weight, label_smoothing=self.label_smoothing)

        self.train_step = 0
        self.img_log_freq = getattr(self, 'img_log_freq', {'train': 50, 'val': 10})
        self.img_log_count = getattr(self, 'img_log_count', 2)

        self.val_metrics = torch.nn.ModuleDict({
            'iou': torchmetrics.JaccardIndex(task='binary'),
            'precision': torchmetrics.Precision(task='binary'),
            'recall': torchmetrics.Recall(task='binary'),
            'f1': torchmetrics.F1Score(task='binary')
        })

    def configure_optimizers(self):
        """
        Configure the optimizer and learning rate scheduler with an optional warm-up.
        """
        optimizer = AdamW(self.parameters(), lr=self.lr, weight_decay=self.weight_decay)

        # Get warm-up epochs from config, defaulting to 0 if not present
        warmup_epochs = getattr(self, 'warmup_epochs', 0)

        # If no warmup is needed, use the original simple scheduler
        if warmup_epochs == 0:
            scheduler = CosineAnnealingLR(
                optimizer=optimizer,
                T_max=self.cos_max_epochs,
                eta_min=self.cos_eta_min,
            )
        # Otherwise, create a sequential scheduler with a warm-up phase
        else:
            # Scheduler for the warm-up phase
            warmup_scheduler = LinearLR(
                optimizer,
                # --- THIS IS THE CORRECTED LINE ---
                start_factor=0.01,  # Corrected from 1e-5 to start at a more effective LR (e.g., 1e-6)
                end_factor=1.0,
                total_iters=warmup_epochs
            )

            # Main scheduler for the post-warmup phase
            main_scheduler_duration = self.cos_max_epochs - warmup_epochs
            main_scheduler = CosineAnnealingLR(
                optimizer,
                T_max=main_scheduler_duration,
                eta_min=self.cos_eta_min,
            )

            # Chain the schedulers together
            scheduler = SequentialLR(
                optimizer,
                schedulers=[warmup_scheduler, main_scheduler],
                milestones=[warmup_epochs]
            )

        return {
            "optimizer": optimizer,
            "lr_scheduler": {
                "scheduler": scheduler,
                "interval": "epoch",
                "frequency": 1
            }
        }

    def forward(self, x):
        return self.model(x)

    def training_step(self, batch, batch_idx):
        data, label = batch

        logits = self.forward(data)
        y_pred = torch.sigmoid(logits)

        loss = self.loss_function(y_pred.unsqueeze(1), label)

        self.log('train_loss', loss, on_step=False, on_epoch=True, prog_bar=True, sync_dist=True)

        self.train_step += 1

        if self.train_step % self.img_log_freq['train'] == 0:
            self.log_images(y_pred.unsqueeze(1), label, "Train", self.train_step)

        lr = self.trainer.optimizers[0].param_groups[0]['lr']
        self.log('learning_rate', lr, on_step=True, on_epoch=False, prog_bar=True, sync_dist=True)

        return loss

    def validation_step(self, batch, batch_idx):
        data, label = batch

        logits = self.forward(data)
        y_pred = torch.sigmoid(logits)
        y_pred_binary = (y_pred > 0.5).float()

        loss = self.loss_function(y_pred.unsqueeze(1), label)
        self.log('val_loss', loss, on_step=False, on_epoch=True, prog_bar=True, sync_dist=True)

        # Update metrics
        for name, metric in self.val_metrics.items():
            metric(y_pred_binary.unsqueeze(1), label)

        # More frequent and diverse validation image logging
        if batch_idx % self.img_log_freq['val'] == 0:
            self.log_images(y_pred.unsqueeze(1), label, "Validation", self.train_step)

    def on_validation_epoch_end(self):
        metric_dict = {f'val_{name}': metric.compute() for name, metric in self.val_metrics.items()}

        # Log to progress bar and wandb
        for name, value in metric_dict.items():
            prog_bar = name in ['val_iou', 'val_f1']  # Only show IoU and F1 in progress bar
            self.log(name, value, prog_bar=prog_bar, sync_dist=True)

        for metric in self.val_metrics.values():
            metric.reset()

    def log_images(self, y_pred, y_true, prefix, step, indices=None):
        """
        Log images to wandb with predictions, ground truth, and keep mask.

        Args:
            y_pred: Predicted segmentation masks
            y_true: Ground truth segmentation masks
            y_keep: Mask indicating which pixels to keep/evaluate
            prefix: Prefix for the log name (e.g., "Train", "Validation")
            step: Current training step
            indices: Specific indices to log. If None, uses default indices.
        """
        if not self.trainer.is_global_zero:
            return

        indices = indices or [0, min(2, len(y_pred) - 1)]

        with torch.no_grad():
            for idx in indices:
                # Concatenate the three images side by side (pred, true, keep)
                combined = torch.cat([y_pred[idx], y_true[idx]], dim=1)
                grid = make_grid(combined).detach().cpu()
                try:
                    wandb.log({f"{prefix} Image {idx}": wandb.Image(grid, caption=f"{prefix} Step {step}")})
                except:
                   pass
