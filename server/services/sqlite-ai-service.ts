import fetch from 'node-fetch';

interface SqliteCloudConfig {
  apiKey: string;
  projectId: string;
  databaseName?: string;
}

interface QueryResult {
  success: boolean;
  data?: any[];
  error?: string;
}

export class SqliteAiService {
  private apiKey: string;
  private projectId: string;
  private databaseName: string;
  private baseUrl: string;
  private connectionString: string;

  constructor(config: SqliteCloudConfig) {
    this.apiKey = config.apiKey;
    this.projectId = config.projectId;
    this.databaseName = config.databaseName || 'database.db';
    this.baseUrl = `https://${this.projectId}.sqlite.cloud:8090/v2`;
    this.connectionString = `sqlitecloud://${this.projectId}.sqlite.cloud:8860/database.db?apikey=${this.apiKey}`;
  }

  async executeQuery(sql: string, params: any[] = []): Promise<QueryResult> {
    try {
      const response = await fetch(`${this.baseUrl}/weblite/sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.connectionString}`,
        },
        body: JSON.stringify({
          sql,
          database: this.databaseName,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SQLite Cloud API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      return {
        success: true,
        data: result.data || result,
      };
    } catch (error) {
      console.error('SQLite Cloud query error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing SQLite Cloud connection...');
      const result = await this.executeQuery('SELECT 1 as test');
      console.log('Connection test result:', result);
      return result.success;
    } catch (error) {
      console.error('SQLite Cloud connection test failed:', error);
      return false;
    }
  }
}

export function createSqliteAiService(): SqliteAiService {
  const apiKey = process.env.SQLITE_AI_API_KEY;
  const projectId = process.env.SQLITE_AI_PROJECT_ID || process.env.SQLITE_AI_USERNAME;
  
  console.log('Debug - Environment variables:');
  console.log('API Key:', apiKey ? 'Set' : 'Not set');
  console.log('Project ID:', projectId);
  console.log('Username:', process.env.SQLITE_AI_USERNAME);
  
  if (!apiKey || !projectId) {
    throw new Error('SQLite Cloud credentials not configured. Please set SQLITE_AI_API_KEY and SQLITE_AI_PROJECT_ID environment variables.');
  }

  return new SqliteAiService({
    apiKey,
    projectId,
    databaseName: 'cmr-procurement', // Use a specific database name
  });
}