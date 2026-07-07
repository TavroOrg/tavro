from fastmcp import Context
from fastmcp.server.elicitation import AcceptedElicitation, DeclinedElicitation, CancelledElicitation


async def _resolve_company_id(
    ctx: Context,
    company_id: Optional[str],
    tenant_id: Optional[str],
) -> Optional[str]:
    """Resolve which company a tool call should run against.

    - If the caller already passed one, trust it.
    - If the tenant has exactly one company, use it silently.
    - If the tenant has more than one, elicit a choice through the client's UI.
    - If the client can't elicit (or the user declines), fall back to None
      so tools keep working the way they do today.
    """
    if company_id and company_id.strip():
        return company_id.strip()

    headers = {"x-tenant-id": str(tenant_id)} if tenant_id else {}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{TAVRO_API_URL}/api/v1/companies", headers=headers)
        resp.raise_for_status()
        companies = resp.json().get("items", [])

    if not companies:
        return None
    if len(companies) == 1:
        return companies[0]["id"]

    choices = {c["id"]: {"title": c["name"]} for c in companies}
    try:
        result = await ctx.elicit(
            "Which company should this apply to?",
            response_type=choices,
        )
    except Exception:
        # Client doesn't support elicitation (e.g. no UI surface for it) — degrade
        # gracefully instead of failing the tool call outright.
        return None

    if isinstance(result, AcceptedElicitation):
        return result.data
    return None  # DeclinedElicitation / CancelledElicitation


@core.tool(name="get_ai_use_case")
async def get_ai_use_case(
    original_prompt: str,
    ctx: Context,
    *,
    use_case_id: Optional[str] = None,
    title: Optional[str] = None,
    start_record: int = 1,
    record_range: str = "1-10",
    company_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    ... (unchanged docstring, except company_id is no longer documented as
    something the caller must always supply — the tool now asks if it's
    missing and ambiguous) ...
    """
    try:
        token = get_access_token()
        tenant_id = token.claims.get("tenant_id") if token else None

        company_id = await _resolve_company_id(ctx, company_id, tenant_id)

        log_tool_call(
            "get_ai_use_case",
            original_prompt,
            {
                "use_case_id": use_case_id,
                "title": title,
                "start_record": start_record,
                "record_range": record_range,
                "company_id": company_id,
            },
            tenant_id,
        )

        # ... rest of the function is unchanged from here on ...
