# /usr/bin/env python3
import json
import sys
from pathlib import Path

# Third-party dependency: requests.
# Install it using: pip install requests
try:
    import requests
except ImportError:
    print(
        "❌ The 'requests' library is not installed. "
        "Please install it by running: pip install requests",
        file=sys.stderr,
    )
    sys.exit(1)

# This script is designed to be run from the project's root directory.
# Therefore, the Current Working Directory is the project root.
# We will create the session.json file in this directory.
SESSION_FILE_PATH = Path("session.json").resolve()


def create_session_file():
    """
    Checks for an existing session.json file. If not found, it prompts the user
    for a Google Maps API key, requests a session token from the Google Tile API,
    and saves the session details to session.json in the project root.
    """
    # Check if session.json already exists in the current directory.
    if SESSION_FILE_PATH.exists():
        print("✅ session.json already exists. Skipping creation.")
        return

    # Prompt the user for their API key.
    try:
        api_key = input(
            "\n🔑 Please enter your Google Maps API Key to create a session token: "
        )
    except KeyboardInterrupt:
        print("\n🚫 Operation cancelled by user. Aborting.")
        sys.exit(1)

    if not api_key:
        print("❌ API Key is required. Aborting.", file=sys.stderr)
        sys.exit(1)

    print("Requesting session token from Google...")

    api_url = f"https://tile.googleapis.com/v1/createSession?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {"mapType": "satellite", "language": "en-US", "region": "US"}

    try:
        # Make the POST request to the Google API.
        response = requests.post(api_url, headers=headers, json=payload)

        # Raise an exception for bad status codes (4xx or 5xx).
        response.raise_for_status()

        session_data = response.json()

        # Structure the content for the session.json file.
        file_content = {
            "session": session_data.get("session"),
            "expiry": session_data.get("expiry"),
            "tileWidth": 512,
            "imageFormat": "png",
            "tileHeight": 512,
        }

        # Write the data to session.json with pretty printing.
        with open(SESSION_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(file_content, f, indent=2)

        print(f"✅ Successfully created {SESSION_FILE_PATH.name} in the project root!")

    except requests.exceptions.HTTPError as http_err:
        # Try to get the specific error message from Google's response.
        error_message = "An unknown HTTP error occurred."
        try:
            error_details = http_err.response.json()
            error_message = error_details.get("error", {}).get(
                "message", http_err
            )
        except json.JSONDecodeError:
            error_message = http_err

        print(
            f"❌ Failed to create session.json. Google API Error: {error_message}",
            file=sys.stderr,
        )
        sys.exit(1)
    except requests.exceptions.RequestException as req_err:
        print(
            f"❌ Failed to create session.json. Request failed: {req_err}",
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    create_session_file()