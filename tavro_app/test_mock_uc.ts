import fs from 'fs';

const mockDataStr = fs.readFileSync('src/data/mcpMockData.json', 'utf-8');
const mockData = JSON.parse(mockDataStr);

function testGetUseCaseCatalogPage() {
    const data = mockData.tools['get_ai_use_case:{"start_record":1,"record_range":"1-10"}'];
    
    let rawList: any[] = [];
    if (Array.isArray(data)) {
        rawList = data;
    } else if (data) {
        const candidates = [
            data.ai_use_case_agent_card,
            data.use_cases,
            data.ai_use_cases,
            data.useCases,
            data.items,
            data.results,
            data.data,
            data.catalog,
            data.records,
        ];
        for (const c of candidates) {
            if (Array.isArray(c) && c.length >= 0) {
                rawList = c;
                break;
            }
        }
        if (rawList.length === 0 && (data.identifier || data.number)) {
            rawList = [data];
        }
    }
    
    const useCases = rawList;
    const totalRecords = data?.total_records ?? data?.totalRecords ?? data?.total ?? useCases.length;
    
    console.log(`Use cases found: ${useCases.length}`);
    console.log(`Total records: ${totalRecords}`);
}

testGetUseCaseCatalogPage();
