// Section/Field picker for the Reference Tables page — mirrors the main
// portal's left nav so admins pick a section the way they already
// recognize it. table_name/column_name are the real (bare, unqualified)
// Postgres identifiers stored on public.lookup.
//
// Sections with no configurable fields yet are omitted entirely — add the
// section back once you have a table/column mapping for it.

export interface ReferenceFieldDef {
    fieldLabel: string;
    tableName: string;
    columnName: string;
}

export interface ReferenceSectionDef {
    navGroup: 'Blueprint' | 'Plan' | 'Build' | 'Govern';
    sectionLabel: string;
    locked?: boolean;
    fields: ReferenceFieldDef[];
}

export const REFERENCE_FIELDS_CATALOG: ReferenceSectionDef[] = [
    {
        navGroup: 'Blueprint', sectionLabel: 'Company Profile',
        fields: [
            { fieldLabel: 'Industry', tableName: 'company', columnName: 'industry' },
        ],
    },
    {
        navGroup: 'Blueprint', sectionLabel: 'Applications',
        fields: [
            { fieldLabel: 'Emergency Tier',        tableName: 'business_applications', columnName: 'emergency_tier' },
            { fieldLabel: 'Business Criticality',  tableName: 'business_applications', columnName: 'business_criticality' },
        ],
    },
    {
        navGroup: 'Blueprint', sectionLabel: 'Processes',
        fields: [
            { fieldLabel: 'Business Criticality',  tableName: 'business_processes', columnName: 'business_criticality' },
            { fieldLabel: 'Financial Impact',       tableName: 'business_processes', columnName: 'financial_impact' },
            { fieldLabel: 'Regulatory Impact',      tableName: 'business_processes', columnName: 'regulatory_impact' },
            { fieldLabel: 'Reputational Impact',    tableName: 'business_processes', columnName: 'reputational_impact' },
            { fieldLabel: 'Process Health State',   tableName: 'business_processes', columnName: 'process_health_state' },
        ],
    },
    {
        navGroup: 'Blueprint', sectionLabel: 'Integrations',
        fields: [
            { fieldLabel: 'Emergency Tier',          tableName: 'business_integrations', columnName: 'emergency_tier' },
            { fieldLabel: 'Business Criticality',    tableName: 'business_integrations', columnName: 'business_criticality' },
            { fieldLabel: 'Protocol',                tableName: 'business_integrations', columnName: 'protocol' },
            { fieldLabel: 'Authentication Method',   tableName: 'business_integrations', columnName: 'authentication_method' },
            { fieldLabel: 'Data Sensitivity',        tableName: 'business_integrations', columnName: 'data_sensitivity' },
            { fieldLabel: 'Availability Status',     tableName: 'business_integrations', columnName: 'availability_status' },
        ],
    },
    {
        navGroup: 'Blueprint', sectionLabel: 'AI Models',
        fields: [
            { fieldLabel: 'Vendor or In-house', tableName: 'ai_models', columnName: 'vendor_or_inhouse' },
            { fieldLabel: 'Provider',           tableName: 'ai_models', columnName: 'provider' },
            { fieldLabel: 'Type of model',       tableName: 'ai_models', columnName: 'model_type' },
            { fieldLabel: 'The class of techniques used by the model to learn patterns from data', tableName: 'ai_models', columnName: 'technique_class' },
            { fieldLabel: 'The learning approach used to train the model',                          tableName: 'ai_models', columnName: 'learning_approach' },
            { fieldLabel: 'Level of automation of the decisions',                                    tableName: 'ai_models', columnName: 'automation_level' },
            { fieldLabel: 'How often the model is updated or retrained',                             tableName: 'ai_models', columnName: 'update_frequency' },
            { fieldLabel: 'Status',               tableName: 'ai_models', columnName: 'status' },
            { fieldLabel: 'Emergency Tier',        tableName: 'ai_models', columnName: 'emergency_tier' },
            { fieldLabel: 'Business Criticality',  tableName: 'ai_models', columnName: 'business_criticality' },
        ],
    },

    {
        navGroup: 'Plan', sectionLabel: 'AI Use Case',
        fields: [
            { fieldLabel: 'AI Use Case Status', tableName: 'ai_use_cases', columnName: 'status' },
            { fieldLabel: 'Priority',            tableName: 'ai_use_cases', columnName: 'priority' },
        ],
    },
    {
        navGroup: 'Plan', sectionLabel: 'Agents',
        fields: [
            { fieldLabel: 'Agent Type', tableName: 'agents', columnName: 'agent_type' },
        ],
    },

    {
        navGroup: 'Govern', sectionLabel: 'Compliance', locked: true,
        fields: [
            { fieldLabel: 'Industry Tags',  tableName: 'compliance_item',   columnName: 'industry_tags' },
            { fieldLabel: 'Jurisdiction',    tableName: 'compliance_item',   columnName: 'jurisdiction' },
            { fieldLabel: 'Issuing Body',    tableName: 'compliance_item',   columnName: 'issuing_body' },
            { fieldLabel: 'Impact Type',     tableName: 'compliance_impact', columnName: 'impact_type' },
        ],
    },
    {
        navGroup: 'Govern', sectionLabel: 'Issues',
        fields: [
            { fieldLabel: 'Issue Type', tableName: 'issues', columnName: 'issue_type' },
            { fieldLabel: 'Severity',   tableName: 'issues', columnName: 'severity' },
            { fieldLabel: 'Source',     tableName: 'issues', columnName: 'source' },
            { fieldLabel: 'Status',     tableName: 'issues', columnName: 'status' },
        ],
    },
];

export function findFieldLabels(tableName: string, columnName: string): { navGroup: string; sectionLabel: string; fieldLabel: string } | null {
    for (const section of REFERENCE_FIELDS_CATALOG) {
        const field = section.fields.find(f => f.tableName === tableName && f.columnName === columnName);
        if (field) return { navGroup: section.navGroup, sectionLabel: section.sectionLabel, fieldLabel: field.fieldLabel };
    }
    return null;
}
