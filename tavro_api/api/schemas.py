# =============================================================
# api/schemas.py
# Pydantic v2 request/response models
# =============================================================

from __future__ import annotations
from uuid import UUID
from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Enums (mirror Postgres enums as strings — no import coupling) ──

DimCategory     = str   # profile | strategy | process | application | organisation | technology | risk | finance | custom
VisibilityLevel = str   # public | internal | restricted | confidential
RelType         = str   # depends_on | owned_by | supports | risks | enables | part_of | governed_by | replaced_by | custom


# ── Company ───────────────────────────────────────────────────

class CompanyBase(BaseModel):
    name:         str
    industry:     str
    region:       str = ""
    legal_entity: Optional[str] = None

class CompanyCreate(CompanyBase):
    pass

class CompanyUpdate(BaseModel):
    name:         Optional[str] = None
    industry:     Optional[str] = None
    region:       Optional[str] = None
    legal_entity: Optional[str] = None

class Company(CompanyBase):
    id:         UUID
    tenant_id:  Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Dimension Type ────────────────────────────────────────────

class DimTypeBase(BaseModel):
    name:           str
    category:       DimCategory
    value_schema:   Optional[dict[str, Any]] = None
    system_defined: bool = False
    max_hops:       int  = Field(default=2, ge=1, le=5)

class DimTypeCreate(DimTypeBase):
    pass

class DimType(DimTypeBase):
    id:         UUID
    created_at: datetime

    class Config:
        from_attributes = True


# ── Dimension Node ────────────────────────────────────────────

# ── Attachment ───────────────────────────────────────────────────────────────

class AttachmentOut(BaseModel):
    id:           UUID
    node_id:      UUID
    filename:     str
    content_type: str
    size_bytes:   int
    uploaded_at:  datetime

    class Config:
        from_attributes = True


# ── Dimension Node ────────────────────────────────────────────

class DimNodeBase(BaseModel):
    label:      str
    summary:    Optional[str]   = None
    tags:       list[str]       = []
    visibility: VisibilityLevel = "internal"
    sensitive:  bool            = False

class DimNodeCreate(DimNodeBase):
    company_id:  UUID
    dim_type_id: UUID
    valid_from:  Optional[datetime] = None

class DimNodeUpdate(BaseModel):
    label:       Optional[str]            = None
    summary:     Optional[str]            = None
    tags:        Optional[list[str]]      = None
    visibility:  Optional[VisibilityLevel] = None
    sensitive:   Optional[bool]           = None
    dim_type_id: Optional[UUID]           = None

class DimNode(DimNodeBase):
    id:           UUID
    company_id:   UUID
    dim_type_id:  UUID
    dim_type_name: Optional[str] = None
    category:      Optional[str] = None
    valid_from:   datetime
    valid_to:     Optional[datetime]
    updated_at:   datetime

    class Config:
        from_attributes = True


# ── Dimension Edge ────────────────────────────────────────────

class DimEdgeBase(BaseModel):
    rel_type:  RelType
    weight:    float = Field(default=0.5, ge=0.0, le=1.0)
    meta:      dict[str, Any] = {}

class DimEdgeCreate(DimEdgeBase):
    source_id: UUID
    target_id: UUID

class DimEdge(DimEdgeBase):
    id:           UUID
    source_id:    UUID
    target_id:    UUID
    source_label: Optional[str] = None
    target_label: Optional[str] = None
    valid_from:   datetime
    valid_to:     Optional[datetime]

    class Config:
        from_attributes = True


# ── Source Reference ──────────────────────────────────────────

class SourceRefBase(BaseModel):
    system_name: str
    external_id: str
    mcp_tool:    str = ""

class SourceRefCreate(SourceRefBase):
    dim_node_id: UUID

class SourceRef(SourceRefBase):
    id:          UUID
    dim_node_id: UUID
    last_synced: Optional[datetime]
    created_at:  datetime

    class Config:
        from_attributes = True

class SourceRefDetail(BaseModel):
    """Response when a source ref drill-down is triggered."""
    source_ref:  SourceRef
    detail:      Optional[dict[str, Any]] = None
    fetched_at:  datetime
    error:       Optional[str] = None


# ── Graph ─────────────────────────────────────────────────────

class GraphNode(BaseModel):
    id:       str
    label:    str
    type:     str        # dim category
    group:    str        # for frontend colour grouping = type

class GraphEdge(BaseModel):
    id:       str
    source:   str
    target:   str
    rel_type: str
    weight:   float

class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


# ── Pagination wrapper ────────────────────────────────────────

class Page(BaseModel):
    total:  int
    offset: int
    limit:  int
    items:  list[Any]
