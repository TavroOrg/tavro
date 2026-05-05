-- =============================================================
-- Tavro Digital Twin — AGE Graph Seed (BankUnited)
-- Run AFTER tavro_bankunited_seed.sql
-- AGE cypher() calls must run outside a transaction block.
-- =============================================================

LOAD 'age';
SET search_path = ag_catalog, twin, public;

-- Company root node
SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:Company {id: 'a1000000-0000-0000-0000-000000000001', name: 'BankUnited'})
$$) AS (result ag_catalog.agtype);

-- All dim nodes
SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a2000000-0000-0000-0000-000000000001', label:'BankUnited Corporate Profile',        type:'Profile'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a3000000-0000-0000-0000-000000000001', label:'Commercial Loan Growth Strategy',     type:'Strategy'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a3000000-0000-0000-0000-000000000002', label:'Digital Banking Modernisation',       type:'Strategy'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a3000000-0000-0000-0000-000000000003', label:'Enterprise Risk Appetite Refresh',    type:'Strategy'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a3000000-0000-0000-0000-000000000004', label:'Deposit Funding Diversification',     type:'Strategy'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a4000000-0000-0000-0000-000000000001', label:'Community Banking Division',          type:'Organisation'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a4000000-0000-0000-0000-000000000002', label:'Commercial Banking Division',         type:'Organisation'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a4000000-0000-0000-0000-000000000003', label:'Multifamily Lending Division',        type:'Organisation'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a4000000-0000-0000-0000-000000000004', label:'Treasury & Capital Markets',          type:'Organisation'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a4000000-0000-0000-0000-000000000005', label:'Technology & Operations Division',    type:'Organisation'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a5000000-0000-0000-0000-000000000001', label:'Commercial Loan Origination',         type:'Process'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a5000000-0000-0000-0000-000000000002', label:'KYC / CDD Onboarding',               type:'Process'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a5000000-0000-0000-0000-000000000003', label:'Credit Risk Review & Grading',        type:'Process'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a5000000-0000-0000-0000-000000000004', label:'Treasury Management Account Opening', type:'Process'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a5000000-0000-0000-0000-000000000005', label:'Regulatory Complaint Management',     type:'Process'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a5000000-0000-0000-0000-000000000006', label:'Regulatory Reporting (Call Report)',  type:'Process'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a6000000-0000-0000-0000-000000000001', label:'FIS Horizon Core Banking',            type:'Application'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a6000000-0000-0000-0000-000000000002', label:'Salesforce Financial Services Cloud', type:'Application'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a6000000-0000-0000-0000-000000000003', label:'Digital Banking Platform',            type:'Application'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a6000000-0000-0000-0000-000000000004', label:'nCino Loan Management System',        type:'Application'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a6000000-0000-0000-0000-000000000005', label:'Moodys RiskCalc / CreditLens',        type:'Application'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a6000000-0000-0000-0000-000000000006', label:'Enterprise Data Warehouse Snowflake', type:'Application'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a6000000-0000-0000-0000-000000000007', label:'Actimize AML Transaction Monitoring', type:'Application'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a7000000-0000-0000-0000-000000000001', label:'Hybrid Cloud Infrastructure',         type:'Technology'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a7000000-0000-0000-0000-000000000002', label:'API Gateway & Integration Layer',     type:'Technology'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a7000000-0000-0000-0000-000000000003', label:'Data & Analytics Platform',           type:'Technology'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a7000000-0000-0000-0000-000000000004', label:'Cybersecurity Programme',             type:'Technology'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a8000000-0000-0000-0000-000000000001', label:'CRE Concentration Risk',              type:'Risk'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a8000000-0000-0000-0000-000000000002', label:'Interest Rate Risk',                  type:'Risk'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a8000000-0000-0000-0000-000000000003', label:'Cybersecurity & Data Breach Risk',    type:'Risk'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a8000000-0000-0000-0000-000000000004', label:'Regulatory & Compliance Risk',        type:'Risk'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a8000000-0000-0000-0000-000000000005', label:'Operational Risk',                    type:'Risk'})
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    CREATE (:DimNode {id:'a8000000-0000-0000-0000-000000000006', label:'Liquidity Risk',                      type:'Risk'})
$$) AS (r ag_catalog.agtype);

-- Edges
SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a3000000-0000-0000-0000-000000000002'}),
          (t:DimNode {id:'a4000000-0000-0000-0000-000000000005'})
    CREATE (s)-[:RELATED_TO {rel_type:'OWNED_BY', weight:0.9}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a3000000-0000-0000-0000-000000000001'}),
          (t:DimNode {id:'a8000000-0000-0000-0000-000000000001'})
    CREATE (s)-[:RELATED_TO {rel_type:'RISKS', weight:0.8}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a3000000-0000-0000-0000-000000000002'}),
          (t:DimNode {id:'a8000000-0000-0000-0000-000000000003'})
    CREATE (s)-[:RELATED_TO {rel_type:'RISKS', weight:0.7}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a4000000-0000-0000-0000-000000000002'}),
          (t:DimNode {id:'a5000000-0000-0000-0000-000000000001'})
    CREATE (s)-[:RELATED_TO {rel_type:'OWNED_BY', weight:0.9}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a5000000-0000-0000-0000-000000000001'}),
          (t:DimNode {id:'a6000000-0000-0000-0000-000000000004'})
    CREATE (s)-[:RELATED_TO {rel_type:'DEPENDS_ON', weight:0.9}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a5000000-0000-0000-0000-000000000003'}),
          (t:DimNode {id:'a6000000-0000-0000-0000-000000000005'})
    CREATE (s)-[:RELATED_TO {rel_type:'DEPENDS_ON', weight:0.9}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a5000000-0000-0000-0000-000000000006'}),
          (t:DimNode {id:'a6000000-0000-0000-0000-000000000001'})
    CREATE (s)-[:RELATED_TO {rel_type:'DEPENDS_ON', weight:1.0}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a8000000-0000-0000-0000-000000000001'}),
          (t:DimNode {id:'a5000000-0000-0000-0000-000000000003'})
    CREATE (s)-[:RELATED_TO {rel_type:'GOVERNED_BY', weight:0.9}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a8000000-0000-0000-0000-000000000003'}),
          (t:DimNode {id:'a6000000-0000-0000-0000-000000000001'})
    CREATE (s)-[:RELATED_TO {rel_type:'RISKS', weight:0.9}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a6000000-0000-0000-0000-000000000001'}),
          (t:DimNode {id:'a7000000-0000-0000-0000-000000000002'})
    CREATE (s)-[:RELATED_TO {rel_type:'DEPENDS_ON', weight:0.7}]->(t)
$$) AS (r ag_catalog.agtype);

SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (s:DimNode {id:'a6000000-0000-0000-0000-000000000006'}),
          (t:DimNode {id:'a7000000-0000-0000-0000-000000000003'})
    CREATE (s)-[:RELATED_TO {rel_type:'PART_OF', weight:1.0}]->(t)
$$) AS (r ag_catalog.agtype);

-- Verify
SELECT * FROM ag_catalog.cypher('twin_graph', $$
    MATCH (n:DimNode)
    RETURN n.type AS type, count(*) AS count
$$) AS (type ag_catalog.agtype, count ag_catalog.agtype);
