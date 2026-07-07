// Section/Field picker for the Reference Tables page — mirrors the main
// portal's left nav 1:1 (including locked/coming-soon pages) so admins pick
// a section the way they already recognize it. table_name/column_name are
// the real (bare, unqualified) Postgres identifiers stored on public.lookup.
//
// Sections without fields yet still appear in the picker — their Field list
// is just empty until someone provides the column mapping for that page.

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
    { navGroup: 'Blueprint', sectionLabel: 'Company Profile', fields: [] },
    { navGroup: 'Blueprint', sectionLabel: 'Applications',    fields: [] },
    { navGroup: 'Blueprint', sectionLabel: 'Processes',       fields: [] },
    { navGroup: 'Blueprint', sectionLabel: 'Integrations',    fields: [] },
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
        ],
    },
    { navGroup: 'Blueprint', sectionLabel: 'Roadmap', locked: true, fields: [] },
    { navGroup: 'Blueprint', sectionLabel: 'Spark',                 fields: [] },

    {
        navGroup: 'Plan', sectionLabel: 'AI Use Case',
        fields: [
            { fieldLabel: 'AI Use Case Status', tableName: 'ai_use_cases', columnName: 'status' },
        ],
    },
    {
        navGroup: 'Plan', sectionLabel: 'Agents',
        fields: [
            { fieldLabel: 'Agent Type', tableName: 'agents', columnName: 'agent_type' },
        ],
    },

    { navGroup: 'Build', sectionLabel: 'Agent playground',              fields: [] },
    { navGroup: 'Build', sectionLabel: 'Agent evals', locked: true,     fields: [] },

    { navGroup: 'Govern', sectionLabel: 'Guardrails',    locked: true, fields: [] },
    { navGroup: 'Govern', sectionLabel: 'Compliance',    locked: true, fields: [] },
    { navGroup: 'Govern', sectionLabel: 'Audit center',  locked: true, fields: [] },
    { navGroup: 'Govern', sectionLabel: 'Issues',                      fields: [] },
];

export function findFieldLabels(tableName: string, columnName: string): { navGroup: string; sectionLabel: string; fieldLabel: string } | null {
    for (const section of REFERENCE_FIELDS_CATALOG) {
        const field = section.fields.find(f => f.tableName === tableName && f.columnName === columnName);
        if (field) return { navGroup: section.navGroup, sectionLabel: section.sectionLabel, fieldLabel: field.fieldLabel };
    }
    return null;
}
