import os
from utils.config_loader import load_config

def set_environment(attribute):
    try:
        config = load_config()
        secrets = config.get(attribute, {})

        for key, value in secrets.items():
            if key in os.environ:
                print(f"Environment variable already set, skipping: {key}")
                continue
            os.environ[key] = value
            print(f"Environment variable set for: {key}")

    except Exception as e:
        print(f"Failed to set secrets: {e} for {attribute}")
        raise
