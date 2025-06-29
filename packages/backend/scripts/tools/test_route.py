import requests
import json
import os

# --- Configuration for the inference service ---
BASE_URL = "http://localhost:8001"
INFERENCE_ENDPOINT = f"{BASE_URL}/inference"
MODELS_ENDPOINT = f"{BASE_URL}/models"

def get_available_model(url):
    """
    Fetches a list of available models from the service and returns the first one.
    This makes the test robust, as it doesn't hardcode a model name.
    """
    try:
        print(f"Attempting to fetch available models from: {url}")
        response = requests.get(url)
        response.raise_for_status() # Raise an exception for HTTP errors (4xx or 5xx)
        models = response.json()
        if models:
            print(f"Successfully fetched available models: {models}")
            return models[0] # Return the first model found
        else:
            print("No models found via /models endpoint. Please ensure 'checkpoints/' directory has .ckpt files.")
            return None
    except requests.exceptions.ConnectionError:
        print(f"Error: Could not connect to the inference service at {url}.")
        print("Please ensure 'inference.py' is running (e.g., using `uvicorn packages.backend.scripts.inference:app --reload --port 8001`).")
        return None
    except requests.exceptions.RequestException as e:
        print(f"Error fetching models: {e}")
        return None

def test_inference_route():
    """
    Tests the /inference POST route by sending a sample request.
    """
    print("\n--- Starting inference route test ---")

    # Step 1: Get an available model name from the running service
    model_name_to_use = get_available_model(MODELS_ENDPOINT)
    if not model_name_to_use:
        print("Aborting inference test as no model name could be retrieved.")
        return

    # Step 2: Prepare the inference request data
    # These are dummy tile coordinates. The service will attempt to load them
    # from your configured TILE_ROOT (e.g., data/tiles). If they don't exist,
    # it will log warnings, but the API call structure remains valid.
    request_payload = {
        "tiles": [
            {"x": 42278, "y": 68776},
            {"x": 42279, "y": 68776},
        ],
        "model_name": model_name_to_use,
        "patch_size": 512,  # Optional, will use default if omitted
        "stride": 256,      # Optional, will use default if omitted
        "use_tta": False,   # Optional, will use default if omitted
        "use_oai": False,   # Optional, but the `oai_predictions` field is always processed in the current backend code.
        "oai_model_name": "gpt-4.1-mini" # Required by the Pydantic model in inference.py
    }

    print(f"\nSending POST request to: {INFERENCE_ENDPOINT}")
    print(f"Using model: '{model_name_to_use}'")
    # Print a truncated payload to avoid excessive output from base64 strings
    print(f"Request payload (truncated): {json.dumps(request_payload, indent=2)[:500]}...")

    # Step 3: Send the POST request
    try:
        response = requests.post(INFERENCE_ENDPOINT, json=request_payload)
        response.raise_for_status() # Raise an exception for HTTP errors (4xx or 5xx)

        # Step 4: Process the response
        response_data = response.json()

        print(f"\n--- Inference successful! (HTTP Status Code: {response.status_code}) ---")
        print(f"Service Message: {response_data.get('message', 'No message provided')}")
        print(f"Number of regular predictions received: {len(response_data.get('predictions', []))}")
        print(f"Number of OAI predictions received: {len(response_data.get('oai_predictions', []))}")

        # Optionally print a sample prediction to verify data format
        if response_data.get('predictions'):
            print("\nSample regular prediction:")
            sample_pred = response_data['predictions'][0]
            print(f"  X: {sample_pred['x']}, Y: {sample_pred['y']}")
            print(f"  Prob PNG B64 (first 50 chars): {sample_pred['prob_png_b64'][:50]}...")
        if response_data.get('oai_predictions'):
            print("\nSample OAI prediction:")
            sample_oai_pred = response_data['oai_predictions'][0]
            print(f"  X: {sample_oai_pred['x']}, Y: {sample_oai_pred['y']}")
            print(f"  Prob: {sample_oai_pred['prob']}, Label: {sample_oai_pred['label']}")

    except requests.exceptions.ConnectionError:
        print(f"\nError: Could not connect to the inference service at {BASE_URL}.")
        print("Please ensure 'inference.py' is running.")
    except requests.exceptions.HTTPError as e:
        print(f"\nHTTP Error occurred: {e}")
        print(f"Response status code: {response.status_code}")
        print(f"Response content (if available): {response.text}")
    except requests.exceptions.RequestException as e:
        print(f"\nAn unexpected request error occurred: {e}")
    except json.JSONDecodeError:
        print(f"\nError: Could not decode JSON response. Raw response: {response.text}")
    except Exception as e:
        print(f"\nAn unhandled error occurred: {e}")

    print("\n--- Inference route test finished ---")

if __name__ == "__main__":
    test_inference_route()