import fetch from 'node-fetch';

const PYTHON_API_URL = process.env.PYTHON_INFERENCE_API_URL || 'http://localhost:8001';
const TIMEOUT_MS = Number(process.env.INFER_TIMEOUT_MS ?? 600_000);

/**
 * Fetches the list of available models from the Python service.
 */
export async function getAvailableModels() {
    try {
        const response = await fetch(`${PYTHON_API_URL}/models`);
        if (!response.ok) {
            throw new Error(`Failed to fetch models: ${response.statusText}`);
        }
        return await response.json();
    } catch (err) {
        console.error("Could not fetch available models from Python service:", err);
        // Return an empty array on failure so the frontend doesn't crash.
        return [];
    }
}

/**
 * Sends a batch of tiles to the Python inference service.
 * @param {{tiles: Array<{x: number, y: number}>, model_name: string}} payload
 * @returns {Promise<object>}
 */
export async function runInference(payload) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const response = await fetch(`${PYTHON_API_URL}/inference`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Inference service failed with status ${response.status}: ${errorText}`);
        }

        return await response.json();
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error(`Inference request timed out after ${TIMEOUT_MS / 1000}s.`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

export default {
    runInference,
    getAvailableModels
};