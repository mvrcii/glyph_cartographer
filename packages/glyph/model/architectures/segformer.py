import warnings
from pathlib import Path

import torch
import torch.nn as nn
import transformers
from transformers import SegformerForSemanticSegmentation


class Segformer(nn.Module):
    def __init__(self,
                 input_dim=1,
                 segformer_from_pretrained='nvidia/mit-b5',
                 dropout=0.2,
                 patch_size=None,
                 label_size=None,
                 in_chans=None,
                 verbose=True,
                 **kwargs):
        """
        Initialize Segformer with individual parameters.

        Args:
            input_dim: Input dimension
            patch_size: Patch size
            segformer_from_pretrained: Pretrained model name for Segformer
            dropout: Dropout rate
            in_chans: Number of input channels
            label_size: Label size
            verbose: Whether to print initialization messages
        """
        super().__init__()

        self.input_dim = input_dim
        self.segformer_from_pretrained = segformer_from_pretrained
        self.patch_size = patch_size
        self.label_size = label_size
        self.in_chans = in_chans
        self.verbose = verbose

        self.dropout = nn.Dropout2d(dropout)

        original_tf_logger_level = transformers.logging.get_verbosity()
        transformers.logging.set_verbosity_error()

        # Suppress specific warnings during model loading
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", category=UserWarning)
            warnings.filterwarnings("ignore", category=FutureWarning)

            self.encoder_2d = SegformerForSemanticSegmentation.from_pretrained(
                pretrained_model_name_or_path=segformer_from_pretrained,
                num_channels=3,
                ignore_mismatched_sizes=True,
                num_labels=1,
            )

        transformers.logging.set_verbosity(original_tf_logger_level)

        # Count parameters in each model component
        segformer_params = sum(p.numel() for p in self.encoder_2d.parameters())

        print(f"\nModel Parameters:")
        print(f"Segformer parameters: {segformer_params:,}")
        print("=" * 50)

    def forward(self, image):
        """
         Forward pass through the model.

         Args:
             image: Input image tensor of shape [batch, channels, depth, height, width]

         Returns:
             torch.Tensor: Output logits
         """
        output = self.encoder_2d(image).logits.squeeze(1)
        return output

    def print_model_summary(self, checkpoint_path=None):
        """
           Print a summary of the model's configuration.

           Args:
               checkpoint_path: Optional path to checkpoint for reference in the summary
           """
        print("\n" + "=" * 50)
        print("Segformer Model Summary")
        print("=" * 50)

        if checkpoint_path:
            print(f"Loaded from: {Path(checkpoint_path).name}")

        print("Model Configuration:")
        print(f"  - in_chans: {self.in_chans}")
        print(f"  - patch_size: {self.patch_size}")
        print(f"  - label_size: {self.label_size}")

        print("\nSegformer Configuration:")
        print(f"  - input_dim: 3")
        print(f"  - output_dim: 1")

        print("=" * 50 + "\n")
