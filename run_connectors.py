import json
from catalog_connector.connector import copilotConnector

# Load config
from utils.config_loader import load_config

config = load_config()

# 🔹 Run Copilot
print("Running Copilot...")
copilot = copilotConnector({
    **config["catalog_connector"]["azure"],
})
copilot.execute()
