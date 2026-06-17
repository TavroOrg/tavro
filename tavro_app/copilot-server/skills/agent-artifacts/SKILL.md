---
name: agent-artifacts
description: Automatically generate Requirements and Technical Design artifacts as PDFs immediately after every successful agent creation
---

# Agent Artifact Generation

After every successful `create_agent` tool call, automatically generate two
governance artifacts for the newly created agent:

- Requirements Document
- Technical Design Document

Do this immediately after confirming the agent was created. Do not wait for
the user to ask.

---

## Template Source

Use the Tavro PDF Document Template loaded from:

`copilot-server/templates/pdf-document-template.md`

That template is the source of truth for document structure, formatting rules,
and document-specific skeletons. Do not use any older Requirement or Technical
section ordering from this skill file.

Use the visual formatting rules in the template as renderer guidance only. Do
not copy or describe the visual header, logo, dark banner, footer, page margin,
or page-number instructions inside the generated Requirements or Technical
markdown. The PDF renderer applies those elements automatically.

---

## Post-Creation Workflow

1. Confirm the agent creation with name and ID in one brief sentence.
2. Generate the full markdown content for the Requirements Document using the
   `Requirements Document Template` section from the Tavro PDF Document Template.
3. Generate the full markdown content for the Technical Design Document using
   the `Technical Design Document Template` section from the Tavro PDF Document
   Template.
4. Call the `generate_agent_artifacts` tool, passing:
   - `agent_id`: the exact agent_id returned by `create_agent`
   - `agent_name`: the exact name of the created agent
   - `requirements_markdown`: the complete markdown of the Requirements Document
   - `technical_markdown`: the complete markdown of the Technical Design Document

The tool converts both markdown documents to PDF and uploads them as
attachments to the agent.

---

## Source Data Rules

- Derive content from the `create_agent` request and result:
  `agent_name`, `description`, `instruction`, `tools`, `knowledge_source`,
  `data_sources`, `tables`, `columns`, and `skills`.
- If a Company Blueprint is present, ground content in its dimensions:
  `[strategy]`, `[risk]`, `[process]`, `[technology]`, and `[integration]`.
- Do not invent tools, platforms, integrations, agent names, systems, owners,
  cloud providers, regulations, or data stores that are not present in the
  source data.
- If a required detail is absent, state it as an assumption or as deferred to
  implementation, following the template's rules.

---

## Output Rules

- Each generated document must start directly with a single `#` heading.
- Use clean markdown only.
- Use ASCII characters only.
- Replace every template placeholder with real content.
- Include document content sections only; never include repeated page headers,
  footer text, logo instructions, visual-format notes, or renderer instructions
  in the markdown body.
- Do not include preamble, apology, completion note, or closing remarks inside
  the document markdown.

---

## Naming Convention

| Document | File Name |
|----------|-----------|
| Requirements Document | `{Agent Name} Requirement.pdf` |
| Technical Design Document | `{Agent Name} Technical.pdf` |
