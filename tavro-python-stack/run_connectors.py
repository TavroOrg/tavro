import json
from catalog_connector.connector import copilotConnector,bedrockConnector,databricksConnector,geminiConnector,salesforceConnector,servicenowConnector,snowflakeConnector,githubConnector 


# Load config
from utils.config_loader import load_config

config = load_config()

# # 🔹 Run Copilot
# print("Running Copilot...")
# copilot = copilotConnector({
#     **config["catalog_connector"]["azure"],
# })
# copilot.execute()

# # 🔹 Run Bedrock
# print("Running Bedrock...")
# bedrock = bedrockConnector({
#     **config["catalog_connector"]["bedrock"],
# })
# bedrock.execute()

# # 🔹 Run ServiceNow
# print("Running ServiceNow...")
# servicenow = servicenowConnector({
#     **config["catalog_connector"]["servicenow"],
# })
# servicenow.execute()

# 🔹 Run Salesforce
print("Running Salesforce...")
salesforce = salesforceConnector({
    **config["catalog_connector"]["salesforce"],
})
salesforce.execute()

# # 🔹 Run Databricks
# print("Running Databricks...")
# databricks = databricksConnector({
#     **config["catalog_connector"]["databricks"],
# })
# databricks.execute()

# # 🔹 Run Snowflake
# print("Running Snowflake...")
# snowflake = snowflakeConnector({
#     **config["catalog_connector"]["snowflake"],
# })
# snowflake.execute()

# # 🔹 Run Gemini
# print("Running Gemini...")
# gemini = geminiConnector({
#     **config["catalog_connector"]["gemini"],
# })
# gemini.execute()

# 🔹 Run GitHub MCP
# print("Running GitHub MCP...")
# github = githubConnector({
#     **config["mcp_connectors"]["github"],
# })
# github.execute()
