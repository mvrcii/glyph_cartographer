/**
 * Defines the structured information for a model.
 */
export interface ModelInfo {
    fullPath: string;
    shortName: string;
    architecture: string | null;
    dateTime: string | null;
    valIou: string | null;
}

/**
 * Extracts detailed information from a model checkpoint path.
 * The path is expected to look like: "checkpoints/kind-breeze-64-sf-b5-250624-034911/best-checkpoint-val_iou=0.361.ckpt"
 * @param fullModelPath The full path to the model checkpoint.
 * @returns An object with extracted model details.
 */
export function getModelInfo(fullModelPath: string): ModelInfo {
    if (!fullModelPath) {
        return {
            fullPath: "unknown",
            shortName: "unknown_model",
            architecture: null,
            dateTime: null,
            valIou: null,
        };
    }

    const path = fullModelPath.replace(/\\/g, '/');
    const pathParts = path.split('/');

    // In a path like "checkpoints/RUN_FOLDER/file.ckpt", RUN_FOLDER is at index 1.
    // This handles paths that may or may not start with "checkpoints/".
    const runFolderIndex = pathParts.length > 1 ? pathParts.length - 2 : 0;
    const runFolderName = pathParts[runFolderIndex] || '';
    const fileName = pathParts[runFolderIndex + 1] || '';

    // Extract IOU from the filename
    const valIouMatch = fileName.match(/val_iou=([\d.]+)/);
    const valIou = valIouMatch ? valIouMatch[1] : null;

    // Extract details from the parent folder name
    const runNameParts = runFolderName.split('-');

    // Short name is the first 3 parts, e.g., "kind-breeze-64"
    const shortName = runNameParts.slice(0, 3).join('-');

    // Date-time is at the end, format YYMMDD-HHMMSS
    const dateTimeMatch = runFolderName.match(/(\d{6}-\d{6})$/);
    const dateTime = dateTimeMatch ? dateTimeMatch[0] : null;

    // Architecture is the part(s) between the short name and the date-time
    let architecture: string | null = null;
    if (shortName && dateTime && runFolderName.startsWith(shortName) && runFolderName.endsWith(dateTime)) {
        const startIndex = shortName.length;
        const endIndex = runFolderName.length - dateTime.length;

        if (startIndex < endIndex) {
            // Extract the middle part and trim leading/trailing hyphens
            const archPart = runFolderName.slice(startIndex, endIndex).replace(/^-|-$/g, '');
            if (archPart) {
                architecture = archPart;
            }
        }
    }

    return {
        fullPath: fullModelPath,
        shortName: shortName || "unknown_model",
        architecture,
        dateTime,
        valIou,
    };
}


/**
 * Extracts a short, human-readable name from a full model checkpoint path.
 * It now uses getModelInfo to ensure consistency.
 * E.g., "checkpoints/dazzling-plasma-63-sf-b5.../best.ckpt" -> "dazzling-plasma-63"
 * @param fullModelPath The full path to the model checkpoint.
 * @returns The extracted short name.
 */
export function getShortModelName(fullModelPath: string): string {
    return getModelInfo(fullModelPath).shortName;
}