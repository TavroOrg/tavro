import json
import copy
import re
import uuid


# -------------------------------
# HELPERS
# -------------------------------
def normalize_tool_name(name):
    return re.sub(r"\s*\(.*?\)", "", name).lower().strip()


def is_system_topic(name):
    if not isinstance(name, str):
        return False

    name = name.lower().strip()

    keywords = [
        "conversation", "fallback", "error", "greeting",
        "thank", "escalate", "start over", "reset",
        "sign in", "multiple topics", "end of conversation", "goodbye"
    ]

    return any(k in name for k in keywords)


def safe_json_load(data):
    try:
        if isinstance(data, str):
            return json.loads(data)
        elif isinstance(data, dict):
            return data
    except:
        pass
    return None

def extract_subagents_from_instruction(text):
    if not text:
        return []

    matches = re.findall(r"subagent://([a-zA-Z0-9_\-]+)", text)
    return list(set(matches))

# -------------------------------
# MAIN FUNCTION
# -------------------------------
def transform_to_agent_cards(bots, components_map, template, connector_type=None):
    agent_cards = []

    for bot in bots:                
        # -------------------------------
        # GEMINI A2A DIRECT PASS-THROUGH
        # -------------------------------
        if connector_type == "gemini" and isinstance(bot.get("raw_agent_card"), dict):
            raw = bot["raw_agent_card"]

            agent_card = copy.deepcopy(template)

            # Direct mappings
            agent_card["name"] = raw.get("name")
            agent_card["description"] = raw.get("description")
            agent_card["instruction_sets"] = []

            #skills
            skills = []
            raw_skills = raw.get("skills") or bot.get("skills") or []

            for s in raw_skills:

                skills.append({
                    "id": s.get("id"),
                    "name": s.get("name"),
                    "description": s.get("description"),
                    "input": None,
                    "output": None
                })
            agent_card["skills"] = skills

            #protocol_version
            agent_card["protocol_version"] = raw.get("protocolVersion") or raw.get("protocol_version")

            #capabilities
            agent_card["capabilities"] = {
                "streaming": False   # ✅ force as per expected output
            }

            #modes
            agent_card["defaultInputModes"] = ["text"]  
            agent_card["defaultOutputModes"] = ["text"]

            #transport
            agent_card["preferredTransport"] = raw.get("preferredTransport")

            # instruction
            bot_id = bot.get("botid", "")
            agent_card["identification"]["agent_id"] = bot_id.split("/")[-1] if "/" in bot_id else bot_id
            agent_card["identification"]["agent_internal_id"] = str(uuid.uuid4())
            agent_card["identification"]["instruction"] = raw.get("description")

            # Provider override
            agent_card["provider"]["organization"] = "Google Gemini for Enterprise"

            if bot.get("name") == "IT Support Agent":
                agent_card["version"] = "1"
            else:
                agent_card["version"] = ""

            # agent_card = OrderedDict(agent_card)

            agent_cards.append({
                "file_name": bot.get("name", "agent").replace(" ", "_") + ".json",
                "data": agent_card
            })

            continue
        bot_id = bot.get("botid")

        tools = []
        data_sources = []
        instruction_sets = []
        seen_tools = set()

        agent_description = bot.get("description", "")
        agent_instruction = bot.get("instruction", "")

        # -------------------------------
        # GEMINI FIX → CLEAN ID
        # -------------------------------
        if connector_type == "gemini" and bot_id and "/" in bot_id:
            bot_id = bot_id.split("/")[-1]

        # -------------------------------
        # COPILOT LOGIC
        # -------------------------------
        components = components_map.get(bot_id, []) if connector_type != "gemini" else []

        for comp in components:
            name = comp.get("name")
            desc = comp.get("description")
            comp_id = comp.get("botcomponentid")
            comp_type = comp.get("componenttype")
            data = comp.get("data", "")

            if not name:
                continue

            data_json = safe_json_load(data)

            # GPT block
            if comp_type == 15:
                agent_description = desc or agent_description

                if isinstance(data, str) and "instructions:" in data:
                    agent_instruction = data.split("instructions:")[-1]
                    agent_instruction = (
                        agent_instruction
                        .replace("|", "")
                        .replace("-\r\n", "")
                        .replace("\r\n", " ")
                        .replace("\n", " ")
                        .strip()
                    )
                continue

            # System topics
            if is_system_topic(name):
                instruction_sets.append({
                    "identifier": comp_id,
                    "name": name,
                    "description": desc,
                    "trigger_condition": None,
                    "priority": 0,
                    "instruction_text": None,
                    "model_parameters_override": None
                })
                continue
            name_lower = name.lower()

            # -------------------------------
            # 1. KNOWLEDGE SOURCE (PDF)
            # -------------------------------
            if ".pdf" in name_lower:
                bot["knowledge_source"] = {
                    "id": comp_id,
                    "name": name
                }
                continue

            # -------------------------------
            # 2. SUBAGENT (Analyzer)
            # -------------------------------
            if "analyzer" in name_lower:
                data_sources.append({
                    "relationship_id": None,
                    "parent_relationship_id": None,
                    "source_object_id": bot_id,
                    "source_object_domain": None,
                    "source_object_name": bot.get("name"),
                    "source_object_type": "Agent",
                    "target_object_id": comp_id,
                    "target_object_domain": None,
                    "target_object_name": name,
                    "target_object_type": "Agent",
                    "access_level": None,
                    "uses_pii": None,
                    "uses_phi": None,
                    "uses_pci": None
                })
                continue

            # -------------------------------
            # 3. REMOVE NON-PREVIEW HUMAN LOOP
            # -------------------------------
            if "human in the loop" in name_lower and "preview" not in name_lower:
                continue

            # -------------------------------
            # 4. TOOL DETECTION
            # -------------------------------
            is_tool = False

            if isinstance(data_json, dict):
                if any(k in data_json for k in ["flowId", "operationId", "apiId", "connectionId"]):
                    is_tool = True

            if not is_tool and comp_type != 15:
                is_tool = True

            if is_tool:
                if name not in seen_tools:
                    seen_tools.add(name)

                    tools.append({
                        "identifier": None,
                        "name": name,
                        "description": desc,
                        "delegation_possible": "false",
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": "Copilot" if connector_type == "copilot" else None,
                        "default_value": None,
                        "input_schema": None,
                        "output_schema": None
                    })

                    data_sources.append({
                        "relationship_id": None,
                        "parent_relationship_id": None,
                        "source_object_id": bot_id,
                        "source_object_domain": None,
                        "source_object_name": bot.get("name"),
                        "source_object_type": "Agent",
                        "target_object_id": comp_id,
                        "target_object_domain": None,
                        "target_object_name": name,
                        "target_object_type": "Tool",
                        "access_level": None,
                        "uses_pii": None,
                        "uses_phi": None,
                        "uses_pci": None
                    })

        # -------------------------------
        # FALLBACK (COPILOT)
        # -------------------------------
        if not tools and not data_sources:
            if bot.get("tool"):
                for t in bot.get("tool", []):
                    name = t.get("name")

                    tools.append({
                        "identifier": None,
                        "name": name,
                        "description": None,
                        "delegation_possible": "false",
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": None if connector_type == "gemini" else "Copilot",
                        "default_value": None,
                        "input_schema": None,
                        "output_schema": None
                    })

                    data_sources.append({
                        "relationship_id": None,
                        "parent_relationship_id": None,
                        "source_object_id": bot_id,
                        "source_object_domain": None,
                        "source_object_name": bot.get("name"),
                        "source_object_type": "Agent",
                        "target_object_id": t.get("id") or t.get("name"),
                        "target_object_domain": None,
                        "target_object_name": name,
                        "target_object_type": "Tool",
                        "access_level": None,
                        "uses_pii": None,
                        "uses_phi": None,
                        "uses_pci": None
                    })

        # -------------------------------
        # GEMINI LOGIC
        # -------------------------------
        # Gemini: fallback to description if instruction missing
        if connector_type == "gemini":
            agent_instruction = bot.get("instruction") or bot.get("description", "")
        else:
            agent_instruction = bot.get("instruction", "")

        # -------------------------------
        # GEMINI SUBAGENT EXTRACTION
        # -------------------------------
        if connector_type == "gemini":
            extracted = extract_subagents_from_instruction(agent_instruction)

            for sub in extracted:
                data_sources.append({
                    "relationship_id": None,
                    "parent_relationship_id": None,
                    "source_object_id": bot_id,
                    "source_object_domain": None,
                    "source_object_name": bot.get("name"),
                    "source_object_type": "Agent",
                    "target_object_id": sub,
                    "target_object_domain": None,
                    "target_object_name": sub.replace("_", " ").title(),
                    "target_object_type": "Agent",
                    "access_level": None,
                    "uses_pii": None,
                    "uses_phi": None,
                    "uses_pci": None
                })
        if connector_type == "gemini":
            instruction_sets = []

        # -------------------------------
        # FINAL AGENT CARD
        # -------------------------------
        agent_card = copy.deepcopy(template)

        agent_card["name"] = bot.get("name", "")
        agent_card["description"] = agent_description
        agent_card["instruction_sets"] = [] if connector_type == "gemini" else instruction_sets

        if tools:
            if connector_type == "gemini":
                # If Gemini tool exists (like googleSearch), keep it
                if any(t.get("name") for t in tools):
                    agent_card["tool"] = tools
                else:
                    # Otherwise set null tool
                    agent_card["tool"] = [{
                        "identifier": None,
                        "name": None,
                        "description": None,
                        "delegation_possible": "false",
                        "allowed_delegates": None,
                        "parameter_name": None,
                        "parameter_type": None,
                        "default_value": None,
                        "input_schema": None,
                        "output_schema": None
                    }]
            else:
                agent_card["tool"] = tools

        if data_sources:
            agent_card["data_source"] = data_sources

        # VERSION ONLY FOR IT SUPPORT AGENT
        if connector_type == "gemini" and bot.get("name") == "IT Support Agent":
            agent_card["version"] = "1"
        else:
            agent_card["version"] = ""
        agent_card["identification"]["agent_id"] = bot_id
        agent_card["identification"]["agent_internal_id"] = str(uuid.uuid4())
        agent_card["identification"]["instruction"] = agent_instruction
        agent_card["identification"]["goal_orientation"] = "0.0"
        agent_card["configuration"]["autonomy_level"] = "0.0"

        # Knowledge source
        if bot.get("knowledge_source"):
            agent_card["knowledge_source"] = {
                "identifier": bot["knowledge_source"].get("id"),
                "name": bot["knowledge_source"].get("name"),
                "access_mechanism": None
            }

        # Provider
        if connector_type == "copilot":
            agent_card["provider"]["organization"] = "Microsoft Copilot Studio"
        elif connector_type == "gemini":
            agent_card["provider"]["organization"] = "Google Gemini for Enterprise"

        agent_cards.append({
            "file_name": bot.get("name", "agent").replace(" ", "_") + ".json",
            "data": agent_card
        })

    return agent_cards



