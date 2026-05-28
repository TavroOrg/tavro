import requests
import json
import re
import os
from pathlib import Path
import html

from .base_connector import BaseConnector
from utils.db import DATABASE_URL
from ..transformers.agent_transformer import transform_to_agent_cards
from worker import init_pool, process_card


class ServiceNowConnector(BaseConnector):

    def __init__(self, config):
        self.config = config
        self.instance_url = (config.get("instance_url") or "").rstrip("/")
        self.auth = (config.get("username"), config.get("password"))

    def get_pg_dsn(self):
        return DATABASE_URL

    def validate_config(self):
        required = ["instance_url", "username", "password"]
        missing = [key for key in required if not self.config.get(key)]
        if missing:
            raise ValueError(
                "Missing servicenow config keys: " + ", ".join(missing)
            )

    def authenticate(self):
        self.auth = (self.config["username"], self.config["password"])

    # -------------------------------
    # FETCH TABLE
    # -------------------------------
    def fetch_table(self, table):
        url = f"{self.instance_url}/api/now/table/{table}"

        params = {
            "sysparm_display_value": "all",
            "sysparm_exclude_reference_link": "true"
        }

        response = requests.get(url, auth=self.auth, params=params, timeout=30)

        if response.status_code != 200:
            raise Exception(f"{table} fetch failed: {response.text}")

        data = response.json().get("result", [])
        print(f"📥 {table} records fetched: {len(data)}")

        return data

    # -------------------------------
    # FETCH ALL
    # -------------------------------
    def fetch_metadata(self):
        print("📡 Fetching ServiceNow tables...")

        return {
            "agents": self.fetch_table("sn_aia_agent"),
            "agent_catalog": self.fetch_table("x_ydllc_tavro_comp_agent_catalog"),
            "tools": self.fetch_table("x_ydllc_tavro_comp_tools"),
            "ai_use_cases": self.fetch_table("x_ydllc_tavro_comp_ai_use_case"),
            "risk_assessments": self.fetch_table("x_ydllc_tavro_comp_agent_risk_assessment"),
            "model_dependencies": self.fetch_table("x_ydllc_tavro_comp_model_dependency"),
            "processes": self.fetch_table("x_ydllc_tavro_comp_process"),
            "controls": self.fetch_table("x_ydllc_tavro_comp_information_technology_controls"),
            "instruction_sets": self.fetch_table("x_ydllc_tavro_comp_topic"),
            "skills": self.fetch_table("x_ydllc_tavro_comp_skills"),
            "applications": self.fetch_table("x_ydllc_tavro_comp_applications"),
            "agent_skill_map": self.fetch_table("x_ydllc_tavro_comp_m2m_agent_catalog_skills"),
            "agent_control_map": self.fetch_table("x_ydllc_tavro_comp_m2m_controls_to_agents"),
            "tables": self.fetch_table("x_ydllc_tavro_comp_table"),
            "columns": self.fetch_table("x_ydllc_tavro_comp_column")
        }

    # -------------------------------
    # NORMALIZE
    # -------------------------------
    def normalize(self, data):

        def extract_display(val):
            if isinstance(val, dict):
                return val.get("display_value") or val.get("value")
            return val

        def parse_model_card(raw):
            try:
                if not raw:
                    return {}
                if isinstance(raw, dict):
                    raw = raw.get("display_value") or raw.get("value")
                if not raw or not isinstance(raw, str):
                    return {}
                cleaned = re.sub(r"<.*?>", "", raw)
                cleaned = html.unescape(cleaned)
                cleaned = cleaned.strip()
                return json.loads(cleaned)

            except Exception as e:
                print("❌ MODEL PARSE FAILED:", e)
                print("RAW TYPE:", type(raw))
                print("RAW VALUE:", raw)
                return {}

        def parse_process_card(raw):
            try:
                if not raw:
                    return {}

                if isinstance(raw, dict):
                    raw = raw.get("display_value") or raw.get("value")

                if not raw or not isinstance(raw, str):
                    return {}

                cleaned = re.sub(r"<.*?>", "", raw)
                cleaned = html.unescape(cleaned).strip()

                return json.loads(cleaned)

            except Exception as e:
                print("❌ PROCESS PARSE FAILED:", e)
                return {}

        def parse_application_card(raw):
            try:
                if not raw:
                    return {}

                if isinstance(raw, dict):
                    raw = raw.get("display_value") or raw.get("value")

                if not raw or not isinstance(raw, str):
                    return {}

                cleaned = re.sub(r"<.*?>", "", raw)
                cleaned = html.unescape(cleaned)
                cleaned = cleaned.strip()
                return json.loads(cleaned)

            except Exception as e:
                print("❌ APPLICATION PARSE FAILED:", e)
                print("CLEANED:", cleaned)
                return {}

        def parse_ai_use_case_card(raw):
            try:
                if not raw:
                    return {}

                if isinstance(raw, dict):
                    raw = raw.get("display_value") or raw.get("value")

                if not raw or not isinstance(raw, str):
                    return {}

                cleaned = re.sub(r"<.*?>", "", raw)
                cleaned = html.unescape(cleaned).strip()

                return json.loads(cleaned)

            except Exception as e:
                print("❌ AI USE CASE PARSE FAILED:", e)
                return {}

        agents = data.get("agents", [])
        catalog_agents = data.get("agent_catalog", [])
        tools = data.get("tools", [])
        ai_use_cases = data.get("ai_use_cases", [])
        risk_assessments = data.get("risk_assessments", [])
        model_dependencies = data.get("model_dependencies", [])
        processes = data.get("processes", [])
        controls = data.get("controls", [])

        # -------------------------------
        # AGENT MAP
        # -------------------------------
        agent_name_map = {}
        for a in agents:
            name = extract_display(a.get("name"))
            sys_id = extract_display(a.get("sys_id"))
            if name and sys_id:
                agent_name_map[name] = extract_display(a.get("agent_id")) or sys_id

        # -------------------------------
        # AGENT RELATION MAP 
        # -------------------------------
        agent_relation_map = {}

        # build catalog_id → name map
        catalog_id_to_name = {}

        for a in agents:
            name = extract_display(a.get("name"))
            catalog_id = extract_display(a.get("agent_id")) or extract_display(a.get("sys_id"))

            if name and catalog_id:
                catalog_id_to_name[catalog_id] = name


        # use catalog table directly
        for rec in catalog_agents:

            # child agent (current)
            child_name = extract_display(rec.get("name"))

            # parent agent (reference)
            parent_ref = rec.get("parent_agent_name")

            if isinstance(parent_ref, dict):
                parent_name = parent_ref.get("display_value")
            else:
                parent_name = parent_ref

            if not child_name or not parent_name:
                continue

            if child_name == parent_name:
                continue

            agent_relation_map.setdefault(child_name, {
                "parents": [],
                "children": []
            })

            agent_relation_map[child_name]["parents"].append(parent_name)


        # CHILD BUILD
        for child, rel in list(agent_relation_map.items()):
            for parent in rel.get("parents", []):
                agent_relation_map.setdefault(parent, {
                    "parents": [],
                    "children": []
                })
                agent_relation_map[parent]["children"].append(child)
        print("\n=== AGENT RELATION MAP ===")
        print(agent_relation_map)

        # -------------------------------
        # TOOL MAP
        # -------------------------------
        tool_map = {}
        for tool in tools:
            agent_name = extract_display(tool.get("agent"))
            agent_id = agent_name_map.get(agent_name)

            if not agent_id:
                continue

            child = tool.get("child_agent")

            if isinstance(child, dict):
                child_agent = child.get("value") or child.get("display_value")
            else:
                child_agent = child

            tool_map.setdefault(agent_id, []).append({
                "identifier": extract_display(tool.get("sys_id")),
                "name": extract_display(tool.get("name")),
                "description": extract_display(tool.get("description")),
                "agent": child_agent   
            })

        tool_table_map = {}

        tables = data.get("tables", [])

        for t in tables:

            table_id = extract_display(t.get("sys_id"))
            table_name = extract_display(t.get("name"))

            tool_ref = t.get("tool")

            if not tool_ref:
                continue

            # HANDLE DICT FORMAT
            if isinstance(tool_ref, dict):
                tool_id = tool_ref.get("value")
            else:
                tool_id = tool_ref

            if not tool_id:
                continue

            tool_id = str(tool_id).strip()

            tool_table_map.setdefault(tool_id, []).append({
                "table_id": table_id,
                "table_name": table_name
            })

        table_column_map = {}

        for col in data.get("columns", []):

            table_ref = col.get("table")
            column_name = extract_display(col.get("name"))
            column_id = extract_display(col.get("sys_id"))

            # table comes as dict
            if isinstance(table_ref, dict):
                table_id = table_ref.get("value")
            else:
                table_id = table_ref

            if not table_id or not column_name:
                continue

            table_id = str(table_id).strip()

            table_column_map.setdefault(table_id, []).append({
                "column_id": column_id,
                "column_name": column_name
            })

        # -------------------------------
        # RISK MAP 
        # -------------------------------
        risk_map = {}

        for r in risk_assessments:
            # GET AGENT NAME
            agent_name = extract_display(r.get("agent_name") or r.get("agent"))

            if not agent_name:
                continue

            # MAP NAME → SYS_ID
            agent_id = agent_name_map.get(agent_name)

            if not agent_id:
                continue

            #  ASSESSOR 
            assessor_ref = r.get("assessor")
            if isinstance(assessor_ref, dict):
                assessor_name = assessor_ref.get("display_value")
            else:
                assessor_name = assessor_ref

            # AIVSS 
            aivss_raw = r.get("aivss_score")

            if isinstance(aivss_raw, dict):
                aivss_val = aivss_raw.get("value") or aivss_raw.get("display_value")
            else:
                aivss_val = aivss_raw

            try:
                aivss_float = float(aivss_val or 0)
            except:
                aivss_float = 0

            # BUILD MAP
            risk_map.setdefault(agent_id, []).append({
                "identifier": extract_display(r.get("number")),
                "name": extract_display(r.get("agent_risk_assessment_name")),
                "assessor": assessor_name,

                "date": extract_display(r.get("sys_updated_on")) or extract_display(r.get("sys_created_on")),

                "blended_risk_score": extract_display(r.get("blended_risk_score")),
                "blended_risk_classification": extract_display(r.get("risk_classification")),

                "aivss_score": aivss_val,
                "aivss_classification": "Medium" if aivss_float >= 4 else "Low",

                "regulatory_risk_score": extract_display(r.get("risk_classification_score")),
                "regulatory_risk_classification": extract_display(r.get("risk_classification")),

                "state": extract_display(r.get("state"))
            })

        # -------------------------------
        # MODEL MAP 
        # -------------------------------
        model_map = {}

        for md in model_dependencies:

            parsed_card = parse_model_card(md.get("model_card"))

            if not parsed_card:
                continue

            model_info = {
                "name": parsed_card.get("model_name"),
                "owner": parsed_card.get("owner"),
                "department_executive": parsed_card.get("department_executive"),
                "description": parsed_card.get("description"),
                "applications": parsed_card.get("application", [])
            }

            agents_list = parsed_card.get("agents", [])

            for a in agents_list:

                agent_id = a.get("agent_id")

                if isinstance(agent_id, dict):
                    agent_id = agent_id.get("value") or agent_id.get("display_value")

                if not agent_id:
                    continue

                model_map.setdefault(agent_id, []).append(model_info)

        # -------------------------------
        # PROCESS MAP 
        # -------------------------------
        process_map = {}

        for p in processes:

            parsed = parse_process_card(p.get("process_agentcard"))

            if not parsed:
                continue

            process_info = {
                "identifier": parsed.get("process_number"),
                "name": parsed.get("process_name"),
                "description": parsed.get("process_description"),
                "business_criticality": parsed.get("business_criticality")
            }

            agents_list = parsed.get("agents", [])

            for a in agents_list:

                agent_id = a.get("agent_id")

                if not agent_id:
                    continue

                process_map.setdefault(agent_id, []).append(process_info)

        # -------------------------------
        # CONTROL LOOKUP (sys_id → control)
        # -------------------------------
        control_lookup = {}

        for c in controls:
            control_number = extract_display(c.get("control_number"))   # AI_ACCT_1
            control_name = extract_display(c.get("control_name"))       # Executive Sponsor

            if not control_number:
                continue

            # build combined format (to match M2M)
            combined_key = f"{control_number} - {control_name}" if control_name else control_number

            control_obj = {
                "identifier": control_number.strip(),
                "name": control_name.strip() if control_name else None,
                "objective": extract_display(c.get("control_objective")),
                "domain": extract_display(c.get("control_domain"))
            }

            # MATCH ALL POSSIBLE FORMATS
            control_lookup[str(control_number)] = control_obj              # AI_ACCT_1
            control_lookup[str(control_name)] = control_obj                # Executive Sponsor
            control_lookup[str(combined_key)] = control_obj                # AI_ACCT_1 - Executive Sponsor

        # -------------------------------
        # INSTRUCTION SET MAP
        # -------------------------------
        instruction_map = {}

        for ins in data.get("instruction_sets", []):

            agent_ref = ins.get("agent_id")

            if isinstance(agent_ref, dict):
                agent_name = agent_ref.get("display_value")
                agent_id = agent_name_map.get(agent_name)
            else:
                agent_id = agent_ref

            if not agent_id:
                continue

            instruction_map.setdefault(agent_id, []).append({
                "topic_id": extract_display(ins.get("topic_id")),
                "name": extract_display(ins.get("name")),
                "description": extract_display(ins.get("description")),
                "trigger_condition": extract_display(ins.get("trigger_condition")),
                "priority": 0,
                "instruction_text": "",
                "model_parameters_override": ""
            })

        # -------------------------------
        # AGENT → SKILL IDS MAP 
        # -------------------------------
        agent_skill_ids_map = {}

        for rel in data.get("agent_skill_map", []):

            agent_ref = rel.get("x_ydllc_tavro_comp_agent_catalog")
            skill_ref = rel.get("x_ydllc_tavro_comp_skills")

            agent_id = extract_display(agent_ref)
            skill_id = extract_display(skill_ref)

            if not agent_id or not skill_id:
                continue

            agent_skill_ids_map.setdefault(str(agent_id), set()).add(str(skill_id))

        print("\n=== M2M MAP ===")
        print(agent_skill_ids_map)

        # -------------------------------
        # AGENT → CONTROL IDS MAP
        # -------------------------------
        agent_control_ids_map = {}

        for rel in data.get("agent_control_map", []):

            agent_ref = rel.get("x_ydllc_tavro_comp_agent_catalog")
            control_ref = rel.get("x_ydllc_tavro_comp_information_technolog")

            # normalize agent → ALWAYS NAME
            if isinstance(agent_ref, dict):
                agent_val = agent_ref.get("display_value") or agent_ref.get("value")
            else:
                agent_val = agent_ref

            # if it's sys_id → convert to name
            if agent_val in agent_name_map.values():
                agent_id = next((k for k, v in agent_name_map.items() if v == agent_val), None)
            else:
                agent_id = agent_val

            control_id = extract_display(control_ref)

            if not agent_id or not control_id:
                continue

            agent_control_ids_map.setdefault(str(agent_id), set()).add(str(control_id))

        print("\n=== CONTROL M2M MAP ===")
        print(agent_control_ids_map)

        # -------------------------------
        # SKILL MAP 
        # -------------------------------
        skill_map = {}

        # Build skill lookup (sys_id → skill object)
        skill_lookup = {}

        for s in data.get("skills", []):
            skill_id = extract_display(s.get("skill_id"))   

            skill_lookup[str(skill_id)] = {
                "id": skill_id,
                "name": extract_display(s.get("name")),
                "description": extract_display(s.get("description")),
                "input": extract_display(s.get("input")),
                "output": extract_display(s.get("output"))
            }

        # Map using M2M
        for agent_id, skill_ids in agent_skill_ids_map.items():

            for sid in skill_ids:
                skill = skill_lookup.get(str(sid))

                if skill:
                    skill_map.setdefault(str(agent_id), []).append(skill)

        print("\n=== FINAL SKILL MAP ===")
        print(skill_map)

        # -------------------------------
        # CONTROL MAP (AGENT → CONTROLS)
        # -------------------------------
        control_map = {}

        for agent_id, control_ids in agent_control_ids_map.items():

            for cid in control_ids:
                control = control_lookup.get(str(cid))

                if control:
                    control_map.setdefault(str(agent_id), []).append(control)

        print("\n=== FINAL CONTROL MAP ===")
        print(control_map)

        # -------------------------------
        # APPLICATION MAP
        # -------------------------------
        application_map = {}

        for app in data.get("applications", []):

            parsed = parse_application_card(app.get("application_agentcard"))

            if not parsed:
                continue

            app_info = {
                "identifier": extract_display(app.get("sys_id")),
                "name": parsed.get("application_name"),
                "description": parsed.get("application_description"),
                "business_criticality": parsed.get("business_criticality"),
                "emergency_tier": parsed.get("emergency_tier")
            }

            agents_list = parsed.get("agents", [])

            for a in agents_list:

                agent_id = a.get("agent_id")

                # fallback → map using name
                if not agent_id:
                    agent_name = a.get("agent_name")
                    agent_id = agent_name_map.get(agent_name)

                if not agent_id:
                    continue

                application_map.setdefault(agent_id, []).append(app_info)

        # -------------------------------
        # AI USE CASE MAP 
        # -------------------------------
        ai_use_case_map = {}

        for uc in ai_use_cases:

            parsed = parse_ai_use_case_card(uc.get("ai_use_case_agentcard"))

            if not parsed:
                continue

            use_case_info = {
                "number": parsed.get("number"),
                "title": parsed.get("title"),
                "description": parsed.get("description"),
                "use_case_owner": parsed.get("use_case_owner"),
                "function": parsed.get("business_function"),
                "business_problem_statement": parsed.get("business_problem_statement"),
                "expected_benefits": parsed.get("expected_benefits"),
                "priority": parsed.get("priority"),
                "state": parsed.get("state"),
                "sys_created_by": extract_display(uc.get("sys_created_by"))
            }

            agents_list = parsed.get("agents", [])

            for a in agents_list:

                raw_agent_id = a.get("agent_id")

                # HANDLE DICT FORMAT
                if isinstance(raw_agent_id, dict):
                    raw_agent_id = raw_agent_id.get("value") or raw_agent_id.get("display_value")

                if not raw_agent_id:
                    continue

                # CONVERT SYS_ID → NAME 
                agent_name = next(
                    (k for k, v in agent_name_map.items() if v == raw_agent_id),
                    None
                )

                if not agent_name:
                    continue

                ai_use_case_map.setdefault(agent_name, []).append(use_case_info)

        # -------------------------------
        # FINAL OUTPUT
        # -------------------------------
        output = []

        for agent in agents:
            agent_name = extract_display(agent.get("name"))

            catalog_id = extract_display(agent.get("agent_id"))
            sys_id = extract_display(agent.get("sys_id"))

            final_id = catalog_id or sys_id   # ✅ IMPORTANT

            if not final_id:
                continue
            
            agent_name = extract_display(agent.get("name"))

            controls_data = control_map.get(str(agent_name), [])
            agent_sys_id = final_id 

            from datetime import datetime

            risks = risk_map.get(agent_sys_id, [])

            # FILTER ONLY COMPLETED
            completed_risks = [
                r for r in risks
                if (r.get("state") or "").strip().lower() == "completed"
            ]

            def parse_date(d):
                from datetime import datetime
                if not d:
                    return datetime.min
                try:
                    return datetime.strptime(d, "%Y-%m-%d %H:%M:%S")
                except:
                    try:
                        return datetime.strptime(d, "%Y-%m-%d")
                    except:
                        return datetime.min

            # SORT BY DATE DESC
            completed_risks.sort(key=lambda x: parse_date(x.get("date")), reverse=True)

            selected_risk = completed_risks[0] if completed_risks else (risks[0] if risks else {})

            applications = application_map.get(agent_sys_id, [])
            models = model_map.get(agent_sys_id, [])
            business_process = process_map.get(agent_sys_id, [])
            instruction_sets = instruction_map.get(agent_sys_id, [])
            tool = tool_map.get(final_id, [])
            skills_data = skill_map.get(str(final_id), [])

            ai_models = []
            for m in models:

                ai_models.append({
                    "name": m.get("name"),
                    "owner": m.get("owner"),
                    "department_executive": m.get("department_executive"),
                    "description": m.get("description")
                })
            relations = agent_relation_map.get(agent_name, {})

            output.append({
                "botid": final_id,
                "name": extract_display(agent.get("name")),
                "description": extract_display(agent.get("description")),
                "instruction": extract_display(agent.get("instructions")),
                "role": extract_display(agent.get("role")),

                "tool": tool_map.get(final_id, []),
                "ai_use_case": ai_use_case_map.get(agent_name, []),
                "risk_assessment": selected_risk or {},

                "application": applications,
                "ai_model": ai_models,
                "business_process": business_process,
                "control": controls_data,
                "instruction_sets": instruction_sets,
                "skills": skills_data,

                "parent_agents": relations.get("parents", []),
                "child_agents": relations.get("children", [])
            })
        return output, tool_table_map, table_column_map, agent_name_map

    # -------------------------------
    # EXECUTE
    # -------------------------------
    def execute(self):
        print("Running ServiceNow Connector")
        self.validate_config()
        self.authenticate()

        data = self.fetch_metadata()
        bots, tool_table_map, table_column_map, agent_name_map = self.normalize(data)
        print(f"Found {len(bots)} bots")

        template_path = Path(__file__).resolve().parents[1] / "agent_card_template.json"
        with open(template_path, "r", encoding="utf-8") as file:
            template = json.load(file)

        agent_cards = transform_to_agent_cards(
            bots,
            {"agent_id_map": agent_name_map},
            template,
            "servicenow",
        )

        for card in agent_cards:
            card_data = card.get("data", {})
            card_data.setdefault("provider", {})
            card_data["provider"]["organization"] = "ServiceNow"

        init_pool()
        for agent in agent_cards:
            process_card(agent["data"])

        print("Servicenow execution completed successfully")
