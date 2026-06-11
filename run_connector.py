import os
from dotenv import load_dotenv
from catalog_connector.connector import copilotConnector, bedrockConnector, databricksConnector, geminiConnector, salesforceConnector, servicenowConnector, snowflakeConnector, githubConnector  # noqa: F401

load_dotenv(override=False)

# 🔹 Run Copilot (Azure)
print("Running Copilot...")
copilot = copilotConnector({
    "client_id":     os.getenv("AZURE_CLIENT_ID"),
    "client_secret": os.getenv("AZURE_CLIENT_SECRET"),
    "tenant_id":     os.getenv("AZURE_TENANT_ID"),
    "scope":         os.getenv("AZURE_SCOPE"),
    "org_url":       os.getenv("AZURE_ORG_URL"),
})
copilot.execute()

# # 🔹 Run Bedrock
# print("Running Bedrock...")
# bedrock = bedrockConnector({
#     "access_key": os.getenv("BEDROCK_ACCESS_KEY"),
#     "secret_key": os.getenv("BEDROCK_SECRET_KEY"),
#     "region":     os.getenv("BEDROCK_REGION", "us-east-2"),
# })
# bedrock.execute()

# # 🔹 Run ServiceNow
# print("Running ServiceNow...")
# servicenow = servicenowConnector({
#     "instance_url": os.getenv("SERVICENOW_INSTANCE_URL"),
#     "username":     os.getenv("SERVICENOW_USERNAME"),
#     "password":     os.getenv("SERVICENOW_PASSWORD"),
# })
# servicenow.execute()

# # 🔹 Run Salesforce
# print("Running Salesforce...")
# salesforce = salesforceConnector({
#     "instance_url": os.getenv("SALESFORCE_INSTANCE_URL"),
#     "api_version":  os.getenv("SALESFORCE_API_VERSION"),
#     "access_token": os.getenv("SALESFORCE_ACCESS_TOKEN"),
# })
# salesforce.execute()

# # 🔹 Run Databricks
# print("Running Databricks...")
# databricks = databricksConnector({
#     "workspace_url":    os.getenv("DATABRICKS_WORKSPACE_URL"),
#     "databricks_token": os.getenv("DATABRICKS_TOKEN"),
# })
# databricks.execute()

# # 🔹 Run Snowflake
# print("Running Snowflake...")
# snowflake = snowflakeConnector({
#     "account":  os.getenv("SNOWFLAKE_ACCOUNT"),
#     "database": os.getenv("SNOWFLAKE_DATABASE"),
#     "schema":   os.getenv("SNOWFLAKE_SCHEMA"),
#     "token":    os.getenv("SNOWFLAKE_TOKEN"),
# })
# snowflake.execute()

# # 🔹 Run Gemini
# print("Running Gemini...")
# gemini = geminiConnector({
#     "client_id":     os.getenv("GEMINI_CLIENT_ID"),
#     "client_secret": os.getenv("GEMINI_CLIENT_SECRET"),
#     "project_id":    os.getenv("GEMINI_PROJECT_ID"),
#     "collection_id": os.getenv("GEMINI_COLLECTION_ID"),
#     "engine_id":     os.getenv("GEMINI_ENGINE_ID"),
#     "auth_uri":      os.getenv("GEMINI_AUTH_URI"),
#     "token_uri":     os.getenv("GEMINI_TOKEN_URI"),
# })
# gemini.execute()

# # 🔹 Run GitHub MCP
# print("Running GitHub MCP...")
# github = githubConnector({
#     "base_url": os.getenv("GITHUB_MCP_BASE_URL"),
#     "token":    os.getenv("GITHUB_MCP_TOKEN"),
# })
# github.execute()