import fs from 'fs';

const mockDataStr = fs.readFileSync('src/data/mcpMockData.json', 'utf-8');
const mockData = JSON.parse(mockDataStr);

function testGetCatalogPage() {
    const data = mockData.tools['get_agent_catalog:{"start_record":1,"record_range":"1-10"}'];
    
    let rawList: any[] = [];
    if (Array.isArray(data)) {
        rawList = data;
    } else if (data) {
        const candidates = [
            data.agent_card,
            data.agent_cards,
            data.agents,
            data.catalog,
            data.items,
            data.records,
            data.data,
            data.results,
        ];
        for (const c of candidates) {
            if (Array.isArray(c) && c.length >= 0) {
                rawList = c;
                break;
            }
        }
        if (rawList.length === 0 && data.agent_id) {
            rawList = [data];
        }
    }
    
    const agents = rawList;
    const totalRecords = data?.total_records ?? data?.totalRecords ?? data?.total ?? agents.length;
    
    console.log(`Agents found: ${agents.length}`);
    console.log(`Total records: ${totalRecords}`);
}

testGetCatalogPage();
