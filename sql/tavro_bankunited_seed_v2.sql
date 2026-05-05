-- =============================================================
-- Tavro Digital Twin — Synthetic Seed Data
-- Company: BankUnited (modelled on public profile, BKU NYSE)
-- All data is illustrative / synthetic. Not actual BankUnited data.
-- Run AFTER tavro_digital_twin_ddl.sql
-- =============================================================

BEGIN;

SET search_path = twin, public;

-- =============================================================
-- 0. UUIDs  (deterministic so foreign keys resolve cleanly)
-- =============================================================

-- company
\set co_id         '''a1000000-0000-0000-0000-000000000001'''

-- dim_nodes — Profile
\set dn_profile    '''a2000000-0000-0000-0000-000000000001'''

-- dim_nodes — Strategy (4 nodes)
\set dn_strat_growth    '''a3000000-0000-0000-0000-000000000001'''
\set dn_strat_digital   '''a3000000-0000-0000-0000-000000000002'''
\set dn_strat_risk      '''a3000000-0000-0000-0000-000000000003'''
\set dn_strat_deposit   '''a3000000-0000-0000-0000-000000000004'''

-- dim_nodes — Organisation (5 nodes)
\set dn_org_retail      '''a4000000-0000-0000-0000-000000000001'''
\set dn_org_commercial  '''a4000000-0000-0000-0000-000000000002'''
\set dn_org_mf          '''a4000000-0000-0000-0000-000000000003'''
\set dn_org_treasury    '''a4000000-0000-0000-0000-000000000004'''
\set dn_org_tech        '''a4000000-0000-0000-0000-000000000005'''

-- dim_nodes — Process (6 nodes)
\set dn_proc_loan_orig  '''a5000000-0000-0000-0000-000000000001'''
\set dn_proc_kyc        '''a5000000-0000-0000-0000-000000000002'''
\set dn_proc_credit     '''a5000000-0000-0000-0000-000000000003'''
\set dn_proc_deposit    '''a5000000-0000-0000-0000-000000000004'''
\set dn_proc_complaints '''a5000000-0000-0000-0000-000000000005'''
\set dn_proc_reporting  '''a5000000-0000-0000-0000-000000000006'''

-- dim_nodes — Application (7 nodes)
\set dn_app_core        '''a6000000-0000-0000-0000-000000000001'''
\set dn_app_crm         '''a6000000-0000-0000-0000-000000000002'''
\set dn_app_digital     '''a6000000-0000-0000-0000-000000000003'''
\set dn_app_lms         '''a6000000-0000-0000-0000-000000000004'''
\set dn_app_risk        '''a6000000-0000-0000-0000-000000000005'''
\set dn_app_data        '''a6000000-0000-0000-0000-000000000006'''
\set dn_app_compliance  '''a6000000-0000-0000-0000-000000000007'''

-- dim_nodes — Technology (4 nodes)
\set dn_tech_cloud      '''a7000000-0000-0000-0000-000000000001'''
\set dn_tech_api        '''a7000000-0000-0000-0000-000000000002'''
\set dn_tech_data       '''a7000000-0000-0000-0000-000000000003'''
\set dn_tech_sec        '''a7000000-0000-0000-0000-000000000004'''

-- dim_nodes — Risk (6 nodes)
\set dn_risk_cre        '''a8000000-0000-0000-0000-000000000001'''
\set dn_risk_rate       '''a8000000-0000-0000-0000-000000000002'''
\set dn_risk_cyber      '''a8000000-0000-0000-0000-000000000003'''
\set dn_risk_reg        '''a8000000-0000-0000-0000-000000000004'''
\set dn_risk_ops        '''a8000000-0000-0000-0000-000000000005'''
\set dn_risk_liquidity  '''a8000000-0000-0000-0000-000000000006'''

-- =============================================================
-- 1. COMPANY
-- =============================================================
INSERT INTO twin.company (id, name, industry, region, legal_entity)
VALUES (
    :co_id,
    'BankUnited',
    'Commercial Banking',
    'US-FL',
    'BankUnited, N.A.'
);

-- =============================================================
-- 2. DIM_NODES
-- =============================================================

-- ── Profile ──────────────────────────────────────────────────
INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT
    :dn_profile, :co_id, t.id,
    'BankUnited Corporate Profile',
    'BankUnited (NYSE: BKU) is a federally chartered commercial bank headquartered in Miami Lakes, Florida. '
    'Founded in 2010 following an FDIC-assisted acquisition, the bank holds approximately $35 billion in total assets '
    'and employs around 1,700 staff across Florida and the New York metro area. '
    'It operates through three primary business segments: Community Banking, Multifamily, and Commercial Banking, '
    'with a strong focus on commercial real estate and C&I lending.',
    '["bank","commercial","florida","NYSE:BKU","FDIC","OCC","35B assets"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Profile';

-- ── Strategy ──────────────────────────────────────────────────
INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_strat_growth, :co_id, t.id,
    'Commercial Loan Growth Strategy',
    'BankUnited targets disciplined growth in its C&I and owner-occupied CRE portfolios, focusing on middle-market '
    'businesses in Florida and the New York metro corridor. '
    'The strategy emphasises relationship banking, treasury management cross-sell, and reducing reliance on '
    'multifamily bridge loans to improve loan mix diversity over the 2024-2026 planning horizon.',
    '["strategy","C&I","CRE","middle-market","growth","2024-2026"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Strategy';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_strat_digital, :co_id, t.id,
    'Digital Banking Modernisation',
    'A multi-year programme to migrate retail and business digital channels onto a unified platform, '
    'replacing legacy online banking with a modern API-first architecture. '
    'Key milestones include real-time payments via FedNow, a self-service SMB portal, and AI-assisted '
    'personalisation of product recommendations. Sponsored by the Chief Digital Officer.',
    '["strategy","digital","API","FedNow","SMB","modernisation","CDO"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Strategy';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_strat_risk, :co_id, t.id,
    'Enterprise Risk Appetite Refresh',
    'Annual refresh of the enterprise risk appetite statement, driven by OCC exam findings and '
    'board-level concern over CRE concentration thresholds. '
    'Includes revised stress-test scenarios for a +300bps rate shock, updated concentration limits '
    'for office CRE, and a new operational risk tolerance metric tied to Reg E dispute volumes.',
    '["strategy","risk-appetite","OCC","CRE","stress-test","rate-shock","board"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Strategy';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_strat_deposit, :co_id, t.id,
    'Deposit Funding Diversification',
    'Strategic initiative to reduce reliance on higher-cost brokered deposits by growing '
    'non-interest-bearing operating accounts from commercial clients. '
    'Target: increase core deposit ratio from 58% to 68% of total funding by end of 2025 '
    'through treasury management product expansion and enhanced relationship officer incentives.',
    '["strategy","deposits","funding","treasury-management","NIM","2025"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Strategy';

-- ── Organisation ─────────────────────────────────────────────
INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_org_retail, :co_id, t.id,
    'Community Banking Division',
    'Operates 70 branch locations across Florida, serving retail customers and small businesses. '
    'Responsible for deposit gathering, consumer lending, SBA loans, and business banking relationships '
    'under $5M. Reports to the President of Community Banking.',
    '["organisation","retail","branches","Florida","SBA","deposits","small-business"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Organisation';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_org_commercial, :co_id, t.id,
    'Commercial Banking Division',
    'Covers C&I and CRE lending to middle-market companies, including healthcare, professional services, '
    'and real estate investors. Teams operate in Miami, Tampa, Orlando, and New York. '
    'Manages approximately $12 billion in commercial loans. Reports to the Chief Banking Officer.',
    '["organisation","commercial","C&I","CRE","middle-market","New-York","Miami","$12B"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Organisation';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_org_mf, :co_id, t.id,
    'Multifamily Lending Division',
    'Originates and services bridge and permanent loans on multifamily residential properties, '
    'primarily in New York City and South Florida. Portfolio is approximately $8 billion. '
    'Subject to heightened OCC scrutiny due to CRE concentration; actively reducing new originations.',
    '["organisation","multifamily","bridge-loans","NYC","CRE","$8B","concentration"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Organisation';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_org_treasury, :co_id, t.id,
    'Treasury & Capital Markets',
    'Manages the bank''s balance sheet, interest rate risk, liquidity position, and investment portfolio. '
    'Executes wholesale funding, repo, and FHLB advances. Operates the ALM model and submits '
    'liquidity reports to OCC. Also provides treasury management services to commercial clients.',
    '["organisation","treasury","ALM","liquidity","FHLB","IRR","capital-markets"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Organisation';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_org_tech, :co_id, t.id,
    'Technology & Operations Division',
    'Responsible for core banking infrastructure, digital channels, cybersecurity, and data engineering. '
    'Team of approximately 280 staff and contractors. Manages relationships with FIS, Salesforce, '
    'and cloud infrastructure providers. Reports to the Chief Information Officer.',
    '["organisation","technology","IT","CIO","FIS","Salesforce","cybersecurity","280-staff"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Organisation';

-- ── Process ──────────────────────────────────────────────────
INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_proc_loan_orig, :co_id, t.id,
    'Commercial Loan Origination',
    'End-to-end process covering deal sourcing, term sheet issuance, credit underwriting, approval, '
    'documentation, and funding for commercial loans above $1M. '
    'Average cycle time is 28 days. Currently partially manual with loan data keyed into the LMS '
    'from PDF documents. A process automation initiative is underway to reduce cycle time to 18 days.',
    '["process","loan-origination","commercial","underwriting","28-days","automation"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Process';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_proc_kyc, :co_id, t.id,
    'KYC / CDD Onboarding',
    'Know-Your-Customer and Customer Due Diligence process applied to all new commercial and '
    'institutional accounts. Includes identity verification, beneficial ownership collection, '
    'risk scoring, and periodic review. Governed by BSA/AML policy. '
    'Backlog currently at 340 pending reviews, driving interest in AI-assisted document review.',
    '["process","KYC","CDD","BSA","AML","onboarding","compliance","backlog"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Process';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_proc_credit, :co_id, t.id,
    'Credit Risk Review & Grading',
    'Quarterly review of the commercial loan portfolio to assign and refresh internal risk grades '
    '(1-9 scale). Performed by the independent Credit Review team. Feeds the CECL allowance model '
    'and informs loan loss provisioning. Highly manual process dependent on relationship officer input.',
    '["process","credit-review","risk-grading","CECL","quarterly","provisioning","manual"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Process';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_proc_deposit, :co_id, t.id,
    'Treasury Management Account Opening',
    'Process for onboarding commercial clients onto treasury management products including '
    'ACH origination, wire services, positive pay, and sweep accounts. '
    'Currently requires 4-6 weeks due to manual agreement execution and IT provisioning steps. '
    'A key bottleneck in the deposit diversification strategy.',
    '["process","treasury-management","account-opening","ACH","wire","onboarding","4-6-weeks"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Process';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_proc_complaints, :co_id, t.id,
    'Regulatory Complaint Management',
    'Intake, investigation, and resolution of customer complaints submitted via CFPB, OCC, '
    'or direct channels. Regulated 45-day response window. Currently managed via shared email '
    'inbox and Excel tracker. Volume has grown 22% YoY, straining the 3-person complaints team.',
    '["process","complaints","CFPB","OCC","regulatory","45-days","volume","Excel"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Process';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_proc_reporting, :co_id, t.id,
    'Regulatory Reporting (Call Report / FR Y)',
    'Quarterly preparation and submission of FFIEC Call Report and Federal Reserve FR Y-9C. '
    'Involves 12 teams, 200+ data elements, and a 3-week close cycle. '
    'High manual reconciliation burden between core banking, GL, and treasury systems.',
    '["process","Call-Report","FR-Y-9C","regulatory-reporting","FFIEC","quarterly","manual"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Process';

-- ── Application ───────────────────────────────────────────────
INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_app_core, :co_id, t.id,
    'FIS Horizon Core Banking',
    'Primary core banking platform handling deposit accounts, general ledger, and loan servicing. '
    'On-premises deployment, version 2019.2. Batch-based nightly processing. '
    'Single largest IT dependency; migration to FIS Modern Banking Platform is on the 3-year roadmap.',
    '["application","FIS","core-banking","on-premises","Horizon","GL","deposits","loans"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Application';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_app_crm, :co_id, t.id,
    'Salesforce Financial Services Cloud',
    'CRM platform for commercial bankers and relationship officers. Tracks pipeline, activities, '
    'contacts, and cross-sell opportunities. Integrated with core banking via nightly feed. '
    'Used by ~320 bankers. Mobile access enabled. Salesforce Einstein features partially activated.',
    '["application","Salesforce","CRM","FSC","pipeline","relationship","Einstein","320-users"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Application';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_app_digital, :co_id, t.id,
    'Digital Banking Platform (NCR Terafina)',
    'Online and mobile banking portal for retail and business customers. Supports account opening, '
    'payments, transfers, and e-statements. Business banking module has limited functionality '
    'vs. competitors; subject of the Digital Modernisation strategy. ~140,000 active users.',
    '["application","digital-banking","NCR","Terafina","mobile","online","140K-users","account-opening"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Application';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_app_lms, :co_id, t.id,
    'nCino Loan Management System',
    'Cloud-based loan origination and portfolio management platform for commercial lending. '
    'Deployed in 2021; covers deal structuring, credit memo, approval workflow, and covenant tracking. '
    'Partially integrated with FIS core. Document ingestion still requires manual indexing.',
    '["application","nCino","LMS","loan-origination","cloud","Salesforce","covenants","commercial"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Application';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_app_risk, :co_id, t.id,
    'Moody''s RiskCalc / CreditLens',
    'Credit analysis and probability-of-default modelling tool used by commercial underwriters. '
    'Pulls borrower financial data for spreading and benchmarking. '
    'Output feeds the internal risk grade assigned in the credit review process. '
    'Used by ~85 underwriters and credit analysts.',
    '["application","Moodys","RiskCalc","CreditLens","credit-analysis","PD","underwriting","85-users"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Application';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_app_data, :co_id, t.id,
    'Enterprise Data Warehouse (Snowflake)',
    'Cloud data warehouse consolidating feeds from core banking, CRM, LMS, and treasury systems. '
    'Primary source for management reporting, CECL modelling, and regulatory data. '
    'Data latency is T+1 for most feeds. Self-service BI via Tableau connected to Snowflake.',
    '["application","Snowflake","data-warehouse","EDW","Tableau","BI","CECL","T+1","cloud"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Application';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_app_compliance, :co_id, t.id,
    'Actimize AML / Transaction Monitoring',
    'NICE Actimize platform for BSA/AML transaction monitoring, SAR filing, and sanctions screening. '
    'Generates ~1,200 alerts per month; BSA team reviews and dispositions. '
    'Model validation due in Q3 2025. Integration with OFAC SDN list is automated.',
    '["application","Actimize","AML","BSA","SAR","OFAC","transaction-monitoring","1200-alerts"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Application';

-- ── Technology ────────────────────────────────────────────────
INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_tech_cloud, :co_id, t.id,
    'Hybrid Cloud Infrastructure',
    'Combination of on-premises data centres (Miami Lakes primary, Tampa DR) and AWS for '
    'Snowflake, nCino, and Salesforce integrations. Network connectivity via AWS Direct Connect. '
    'Cloud spend approximately $4.2M annually. No GCP or Azure workloads currently.',
    '["technology","cloud","AWS","hybrid","on-premises","Direct-Connect","DR","Tampa"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Technology';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_tech_api, :co_id, t.id,
    'API Gateway & Integration Layer',
    'MuleSoft Anypoint platform managing integrations between FIS core, Salesforce, nCino, '
    'and Snowflake. ~60 active APIs. Real-time integration is limited; most feeds are '
    'batch/ETL. MuleSoft is a critical dependency for the Digital Modernisation programme.',
    '["technology","MuleSoft","API-gateway","integration","ETL","batch","60-APIs"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Technology';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_tech_data, :co_id, t.id,
    'Data & Analytics Platform',
    'Snowflake-based analytics layer with dbt transformation pipelines, Tableau dashboards, '
    'and a nascent ML model serving layer. Data governance is managed via Collibra. '
    'CCPA and GLBA data classification framework applied to ~80% of data assets.',
    '["technology","data","analytics","dbt","Tableau","Collibra","CCPA","GLBA","ML","Snowflake"]',
    'internal'
FROM twin.dim_type t WHERE t.name = 'Technology';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_tech_sec, :co_id, t.id,
    'Cybersecurity Programme',
    'NIST CSF-aligned security programme. Controls include CrowdStrike EDR, Palo Alto NGFW, '
    'CyberArk PAM, and Splunk SIEM. SOC is co-managed with a MSSP. '
    'Last external penetration test: September 2024. Open high findings: 3. '
    'Annual cyber budget: ~$8M.',
    '["technology","cybersecurity","NIST-CSF","CrowdStrike","Palo-Alto","CyberArk","Splunk","MSSP"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Technology';

-- ── Risk ─────────────────────────────────────────────────────
INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_risk_cre, :co_id, t.id,
    'CRE Concentration Risk',
    'Commercial real estate loans represent approximately 38% of total risk-weighted assets, '
    'exceeding the OCC informal guidance threshold of 300% of capital. '
    'Office sub-sector exposure is $1.4B with average LTV of 68%. '
    'OCC has issued a Matter Requiring Attention (MRA) requiring a concentration management plan by Q2 2025.',
    '["risk","CRE","concentration","OCC","MRA","office","LTV","RWA","Q2-2025"]',
    'confidential'
FROM twin.dim_type t WHERE t.name = 'Risk';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_risk_rate, :co_id, t.id,
    'Interest Rate Risk (Asset Sensitivity)',
    'Balance sheet is asset-sensitive; a 100bps parallel rate decrease would reduce NII by '
    'approximately $42M over 12 months per the current ALM model. '
    'Duration gap is +1.8 years. Fixed-rate loan portfolio is 34% of total loans. '
    'Rate risk is within policy limits but has trended toward the upper bound since Q1 2024.',
    '["risk","interest-rate","ALM","NII","asset-sensitive","duration","100bps","NIM"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Risk';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_risk_cyber, :co_id, t.id,
    'Cybersecurity & Data Breach Risk',
    'Elevated threat exposure due to reliance on third-party SaaS vendors and an aging on-premises '
    'core banking platform with limited encryption-at-rest. '
    'Three high-severity open pen-test findings. Vendor risk management programme covers '
    'top 40 critical suppliers; 12 are due for re-assessment in H1 2025.',
    '["risk","cybersecurity","data-breach","third-party","vendor-risk","pen-test","SaaS","encryption"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Risk';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_risk_reg, :co_id, t.id,
    'Regulatory & Compliance Risk',
    'Supervised by OCC as primary federal regulator, with FDIC and Federal Reserve oversight. '
    'Active examination cycle with OCC focused on BSA/AML, CRA performance, and CRE concentration. '
    'Open MRA on CRE concentration. CRA rating from 2023 exam: Satisfactory. '
    'CFPB supervisory expectations increasing for non-bank product partners.',
    '["risk","regulatory","OCC","FDIC","BSA","AML","CRA","CFPB","MRA","compliance"]',
    'confidential'
FROM twin.dim_type t WHERE t.name = 'Risk';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_risk_ops, :co_id, t.id,
    'Operational Risk — Process & Technology',
    'Key operational risks include manual data re-keying between systems (loan origination, '
    'regulatory reporting), aging core banking platform creating single-point-of-failure exposure, '
    'and staff concentration in critical roles (2 key-person dependencies in Treasury). '
    'Operational loss events in 2024: 18 incidents, $1.2M aggregate loss.',
    '["risk","operational","manual-processes","key-person","core-banking","loss-events","2024"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Risk';

INSERT INTO twin.dim_node
    (id, company_id, dim_type_id, label, summary, tags, visibility)
SELECT :dn_risk_liquidity, :co_id, t.id,
    'Liquidity Risk',
    'LCR (Liquidity Coverage Ratio) is 118%, above the 100% regulatory minimum. '
    'HQLA portfolio of $3.8B. Brokered deposit reliance is 28% of total deposits, '
    'which is elevated relative to peers. Contingency funding plan tested annually; '
    'last stress test showed 35-day survival horizon under an idiosyncratic stress scenario.',
    '["risk","liquidity","LCR","HQLA","brokered-deposits","CFP","stress-test","35-days"]',
    'restricted'
FROM twin.dim_type t WHERE t.name = 'Risk';


-- =============================================================
-- 3. DIM_EDGES  (relationships between nodes)
-- =============================================================

INSERT INTO twin.dim_edge
    (source_id, target_id, rel_type, weight, meta)
VALUES

-- Strategy → Organisation ownership
(:dn_strat_digital,   :dn_org_tech,       'owned_by',   0.9,  '{"note":"CDO sponsors; CIO delivers"}'),
(:dn_strat_deposit,   :dn_org_treasury,   'owned_by',   0.8,  '{"note":"Treasury leads deposit product expansion"}'),
(:dn_strat_growth,    :dn_org_commercial, 'owned_by',   0.9,  '{"note":"Commercial Banking is primary delivery arm"}'),
(:dn_strat_risk,      :dn_org_treasury,   'owned_by',   0.7,  '{"note":"Treasury owns ALM; Risk owns risk appetite doc"}'),

-- Strategy → Risk linkage
(:dn_strat_growth,    :dn_risk_cre,       'risks',      0.8,  '{"note":"Loan growth may worsen CRE concentration"}'),
(:dn_strat_digital,   :dn_risk_cyber,     'risks',      0.7,  '{"note":"Expanded digital surface increases cyber exposure"}'),
(:dn_strat_deposit,   :dn_risk_liquidity, 'enables',    0.7,  '{"note":"Core deposit growth improves liquidity position"}'),

-- Organisation → Process ownership
(:dn_org_commercial,  :dn_proc_loan_orig, 'owned_by',   0.9,  '{"note":"Commercial Banking owns loan origination"}'),
(:dn_org_commercial,  :dn_proc_credit,    'owned_by',   0.8,  '{"note":"Credit Review reports into Commercial Banking"}'),
(:dn_org_commercial,  :dn_proc_deposit,   'owned_by',   0.8,  '{"note":"Relationship officers drive TM onboarding"}'),
(:dn_org_retail,      :dn_proc_complaints,'owned_by',   0.7,  '{"note":"Community Banking handles most CFPB complaints"}'),
(:dn_org_treasury,    :dn_proc_reporting, 'owned_by',   0.9,  '{"note":"Treasury owns Call Report compilation"}'),
(:dn_org_tech,        :dn_proc_kyc,       'supports',   0.6,  '{"note":"Tech provides identity verification tooling"}'),

-- Process → Application dependencies
(:dn_proc_loan_orig,  :dn_app_lms,        'depends_on', 0.9,  '{"note":"nCino is the system of record for origination"}'),
(:dn_proc_loan_orig,  :dn_app_crm,        'depends_on', 0.7,  '{"note":"Pipeline managed in Salesforce FSC"}'),
(:dn_proc_credit,     :dn_app_risk,       'depends_on', 0.9,  '{"note":"RiskCalc/CreditLens used for spreading"}'),
(:dn_proc_credit,     :dn_app_lms,        'depends_on', 0.7,  '{"note":"Risk grades written back to nCino"}'),
(:dn_proc_kyc,        :dn_app_compliance, 'depends_on', 0.9,  '{"note":"Actimize drives screening and alert review"}'),
(:dn_proc_reporting,  :dn_app_core,       'depends_on', 1.0,  '{"note":"Call Report sourced from FIS Horizon GL"}'),
(:dn_proc_reporting,  :dn_app_data,       'depends_on', 0.8,  '{"note":"Snowflake EDW used for data reconciliation"}'),
(:dn_proc_deposit,    :dn_app_core,       'depends_on', 0.8,  '{"note":"Account provisioning in FIS Horizon"}'),
(:dn_proc_complaints, :dn_app_crm,        'depends_on', 0.5,  '{"note":"Some teams log complaints in Salesforce cases"}'),

-- Application → Technology dependencies
(:dn_app_lms,         :dn_tech_cloud,     'depends_on', 0.8,  '{"note":"nCino is AWS SaaS"}'),
(:dn_app_crm,         :dn_tech_cloud,     'depends_on', 0.8,  '{"note":"Salesforce runs on Salesforce cloud (AWS)"}'),
(:dn_app_digital,     :dn_tech_api,       'depends_on', 0.9,  '{"note":"Digital banking calls core via MuleSoft APIs"}'),
(:dn_app_data,        :dn_tech_cloud,     'depends_on', 0.9,  '{"note":"Snowflake is AWS-hosted"}'),
(:dn_app_data,        :dn_tech_data,      'part_of',    1.0,  '{"note":"Snowflake is the centre of the data platform"}'),
(:dn_app_core,        :dn_tech_api,       'depends_on', 0.7,  '{"note":"FIS exposed via MuleSoft to other apps"}'),
(:dn_app_compliance,  :dn_tech_sec,       'governed_by',0.8,  '{"note":"Actimize feeds Splunk SIEM for correlation"}'),

-- Risk → Process / Application links
(:dn_risk_cre,        :dn_proc_credit,    'governed_by',0.9,  '{"note":"Credit review process must flag CRE concentration"}'),
(:dn_risk_ops,        :dn_proc_loan_orig, 'risks',      0.8,  '{"note":"Manual re-keying is primary operational risk vector"}'),
(:dn_risk_ops,        :dn_proc_reporting, 'risks',      0.7,  '{"note":"Manual reconciliation creates reporting error risk"}'),
(:dn_risk_cyber,      :dn_app_core,       'risks',      0.9,  '{"note":"Aging on-prem core is highest-priority cyber risk"}'),
(:dn_risk_cyber,      :dn_tech_sec,       'governed_by',0.9,  '{"note":"Cybersecurity programme is primary control"}'),
(:dn_risk_reg,        :dn_proc_kyc,       'governed_by',0.9,  '{"note":"BSA/AML compliance depends on KYC process quality"}'),
(:dn_risk_rate,       :dn_org_treasury,   'governed_by',0.9,  '{"note":"Treasury owns IRR management and ALM model"}'),
(:dn_risk_liquidity,  :dn_org_treasury,   'governed_by',0.9,  '{"note":"Treasury manages LCR, HQLA, and CFP"}'),
(:dn_risk_liquidity,  :dn_risk_rate,      'depends_on', 0.6,  '{"note":"Rate movements affect deposit run-off assumptions"}'),

-- Cross-cutting: strategy enables/risks
(:dn_strat_digital,   :dn_app_digital,    'enables',    0.9,  '{"note":"Digital modernisation programme targets this app"}'),
(:dn_strat_digital,   :dn_tech_api,       'enables',    0.8,  '{"note":"API-first architecture is a programme deliverable"}'),
(:dn_strat_growth,    :dn_proc_loan_orig, 'enables',    0.7,  '{"note":"Growth strategy requires faster origination"}');


-- =============================================================
-- 4. SOURCE_REFS  (where to fetch detail for each node)
-- =============================================================
INSERT INTO twin.source_ref
    (dim_node_id, system_name, external_id, mcp_tool)
VALUES
(:dn_app_core,        'FIS Horizon',          'APP-FIS-HORIZON-001',   'fis_get_application_detail'),
(:dn_app_crm,         'Salesforce FSC',       'APP-SF-FSC-001',        'salesforce_get_object'),
(:dn_app_digital,     'NCR Terafina',         'APP-NCR-TERA-001',      'ncr_get_platform_status'),
(:dn_app_lms,         'nCino',                'APP-NCINO-001',         'ncino_get_application_detail'),
(:dn_app_risk,        'Moodys Analytics',     'APP-MA-RISKCALC-001',   'moodys_get_product_detail'),
(:dn_app_data,        'Snowflake',            'APP-SNOW-EDW-001',      'snowflake_get_environment'),
(:dn_app_compliance,  'NICE Actimize',        'APP-ACTIMIZE-001',      'actimize_get_system_detail'),

(:dn_proc_loan_orig,  'Confluence',           'PROC-LOAN-ORIG-2024',   'confluence_get_page'),
(:dn_proc_kyc,        'Confluence',           'PROC-KYC-CDD-2024',     'confluence_get_page'),
(:dn_proc_credit,     'Confluence',           'PROC-CREDIT-REV-2024',  'confluence_get_page'),
(:dn_proc_reporting,  'Confluence',           'PROC-REG-RPT-2024',     'confluence_get_page'),
(:dn_proc_complaints, 'ServiceNow',           'KB-COMP-MGMT-001',      'servicenow_get_kb_article'),
(:dn_proc_deposit,    'Confluence',           'PROC-TM-OPEN-2024',     'confluence_get_page'),

(:dn_risk_cre,        'Archer GRC',           'RISK-CRE-CONC-001',     'archer_get_risk_record'),
(:dn_risk_rate,       'Archer GRC',           'RISK-IRR-ALM-001',      'archer_get_risk_record'),
(:dn_risk_cyber,      'Archer GRC',           'RISK-CYBER-001',        'archer_get_risk_record'),
(:dn_risk_reg,        'Archer GRC',           'RISK-REG-COMP-001',     'archer_get_risk_record'),
(:dn_risk_ops,        'Archer GRC',           'RISK-OPS-001',          'archer_get_risk_record'),
(:dn_risk_liquidity,  'Archer GRC',           'RISK-LIQ-001',          'archer_get_risk_record'),

(:dn_org_retail,      'Workday',              'ORG-COMMUNITY-BKG',     'workday_get_org_unit'),
(:dn_org_commercial,  'Workday',              'ORG-COMMERCIAL-BKG',    'workday_get_org_unit'),
(:dn_org_mf,          'Workday',              'ORG-MULTIFAMILY',       'workday_get_org_unit'),
(:dn_org_treasury,    'Workday',              'ORG-TREASURY',          'workday_get_org_unit'),
(:dn_org_tech,        'Workday',              'ORG-TECH-OPS',          'workday_get_org_unit'),

(:dn_strat_growth,    'Confluence',           'STRAT-LOAN-GROWTH-2025','confluence_get_page'),
(:dn_strat_digital,   'Confluence',           'STRAT-DIGITAL-MOD-2025','confluence_get_page'),
(:dn_strat_risk,      'Archer GRC',           'STRAT-RISK-APP-2025',   'archer_get_risk_record'),
(:dn_strat_deposit,   'Confluence',           'STRAT-DEPOSIT-DIV-2025','confluence_get_page');


COMMIT;
