/**
 * Calculates the mean brightness of an image from a URL.
 * It uses an efficient technique where the image is resized to a 1x1 pixel
 * ImageBitmap during fetching, allowing the single resulting pixel to be read
 * as the average color of the original image.
 */
async function meanBrightness(url) {
    const bitmap = await createImageBitmap(
        await (await fetch(url)).blob(),
        {resizeWidth: 1, resizeHeight: 1, resizeQuality: 'low'}
    );

    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(bitmap, 0, 0, 1, 1);

    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return Math.round((r * 299 + g * 587 + b * 114) / 1000);
}


// Listen for messages from the main thread.
self.onmessage = async (event) => {
    const {key, url} = event.data;

    try {
        const brightness = await meanBrightness(url);
        self.postMessage({key, value: brightness, status: 'fulfilled'});
    } catch (error) {
        self.postMessage({key, value: -1, status: 'rejected', error: error.message});
    }
};