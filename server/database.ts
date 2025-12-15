import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { SqliteAiService, createSqliteAiService } from './services/sqlite-ai-service.js';

// Type definitions
interface DocumentRow {
  id: string;
  original_name: string;
  renamed_name: string;
  file_type: string;
  file_size: number;
  file_path: string | null;
  status: string;
  supplier: string | null;
  po_number: string | null;
  pr_number: string | null;
  project_number: string | null;
  job_number: string | null;
  do_number: string | null;
  date: string | null;
  delivery_date: string | null;
  total_amount: string | null;
  page_count: number;
  created_at: string;
  updated_at: string;
  items?: string | null;
  delivery_number?: string | null;
  order_number?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  document_number?: string | null;
  delivery_terms?: string | null;
  payment_terms?: string | null;
  currency?: string | null;
  total_quantity?: string | null;
  your_reference?: string | null;
  rc_number?: string | null;
  gst_number?: string | null;
  company_reg_no?: string | null;
  fax?: string | null;
  website?: string | null;
  contact_person?: string | null;
  shipping_method?: string | null;
  special_instructions?: string | null;
  discount?: string | null;
  subtotal?: string | null;
  tax_amount?: string | null;
  document_type?: string | null;
  extracted_numbers?: string | null;
  extracted_codes?: string | null;
  all_dates_found?: string | null;
  all_amounts_found?: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database path
const DB_PATH = path.join(__dirname, '../database.db');

// Database instances
let db: Database.Database;
let sqliteAiService: SqliteAiService | null = null;
let useRemoteDb = false;

export const initDatabase = async () => {
  try {
    // SQLite.ai connection temporarily disabled - using local SQLite
    // Uncomment below when you want to use remote database
    /*
    try {
      sqliteAiService = createSqliteAiService();
      const connected = await sqliteAiService.testConnection();
      if (connected) {
        console.log('SQLite.ai remote database connected successfully');
        useRemoteDb = true;
        return sqliteAiService;
      }
    } catch (error) {
      console.log('SQLite.ai not available, falling back to local database:', error.message);
    }
    */
    
    // Fallback to local SQLite
    db = new Database(DB_PATH);
    console.log('Local SQLite database connected successfully');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    
    // Create tables if they don't exist
    createTables();
    
    return db;
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

export const getDatabase = async () => {
  if (useRemoteDb && sqliteAiService) {
    return sqliteAiService;
  }
  if (!db && !useRemoteDb) {
    return await initDatabase();
  }
  return db;
};

const createTables = () => {
  try {
    // Documents table
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        original_name TEXT NOT NULL,
        renamed_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_path TEXT,
        status TEXT NOT NULL DEFAULT 'Processed',
        supplier TEXT,
        po_number TEXT,
        project_number TEXT,
        date TEXT,
        delivery_date TEXT,
        total_amount TEXT,
        page_count INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Document items table (for extracted items)
    db.exec(`
      CREATE TABLE IF NOT EXISTS document_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        item_description TEXT NOT NULL,
        item_order INTEGER DEFAULT 0,
        sn TEXT,
        part_number TEXT,
        quantity TEXT,
        uom TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
      )
    `);

    // Additional document data table (for extended extracted data)
    db.exec(`
      CREATE TABLE IF NOT EXISTS document_additional_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL,
        delivery_number TEXT,
        order_number TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        document_number TEXT,
        delivery_terms TEXT,
        payment_terms TEXT,
        currency TEXT DEFAULT 'S$',
        total_quantity TEXT,
        your_reference TEXT,
        rc_number TEXT,
        gst_number TEXT,
        company_reg_no TEXT,
        fax TEXT,
        website TEXT,
        contact_person TEXT,
        shipping_method TEXT,
        special_instructions TEXT,
        discount TEXT,
        subtotal TEXT,
        tax_amount TEXT,
        document_type TEXT,
        extracted_numbers TEXT,
        extracted_codes TEXT,
        all_dates_found TEXT,
        all_amounts_found TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_supplier ON documents(supplier);
      CREATE INDEX IF NOT EXISTS idx_documents_po_number ON documents(po_number);
      CREATE INDEX IF NOT EXISTS idx_documents_project_number ON documents(project_number);
      CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
      CREATE INDEX IF NOT EXISTS idx_document_items_document_id ON document_items(document_id);
      CREATE INDEX IF NOT EXISTS idx_document_additional_data_document_id ON document_additional_data(document_id);
    `);

    // Migrate existing tables to add new columns if they don't exist
    try {
      // Check if sn column exists in document_items
      const itemsTableInfo = db.prepare('PRAGMA table_info(document_items)').all() as any[];
      const hasSnColumn = itemsTableInfo.some((col: any) => col.name === 'sn');

      if (!hasSnColumn) {
        console.log('Migrating document_items table to add new columns...');
        db.exec(`
          ALTER TABLE document_items ADD COLUMN sn TEXT;
          ALTER TABLE document_items ADD COLUMN part_number TEXT;
          ALTER TABLE document_items ADD COLUMN quantity TEXT;
          ALTER TABLE document_items ADD COLUMN uom TEXT;
        `);
        console.log('document_items migration completed');
      }

      // Check if pr_number column exists in documents table
      const docsTableInfo = db.prepare('PRAGMA table_info(documents)').all() as any[];
      const hasPrNumber = docsTableInfo.some((col: any) => col.name === 'pr_number');
      const hasJobNumber = docsTableInfo.some((col: any) => col.name === 'job_number');
      const hasDoNumber = docsTableInfo.some((col: any) => col.name === 'do_number');

      if (!hasPrNumber || !hasJobNumber || !hasDoNumber) {
        console.log('Migrating documents table to add new columns...');
        if (!hasPrNumber) {
          db.exec(`ALTER TABLE documents ADD COLUMN pr_number TEXT;`);
        }
        if (!hasJobNumber) {
          db.exec(`ALTER TABLE documents ADD COLUMN job_number TEXT;`);
        }
        if (!hasDoNumber) {
          db.exec(`ALTER TABLE documents ADD COLUMN do_number TEXT;`);
        }
        console.log('documents migration completed');
      }
    } catch (error) {
      console.error('Migration error (non-fatal):', error);
    }

    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error creating database tables:', error);
    throw error;
  }
};

// Document operations
export const saveDocument = async (documentData: any) => {
  try {
    const dbInstance = await getDatabase();

    // Check if it's a local database (has transaction and prepare methods)
    if (!('transaction' in dbInstance)) {
      throw new Error('Transaction not supported with remote database');
    }

    const db = dbInstance as Database.Database;

    // Begin transaction
    const transaction = db.transaction((data: any) => {
      // Insert main document record
      const insertDocument = db.prepare(`
        INSERT INTO documents (
          id, original_name, renamed_name, file_type, file_size, file_path,
          status, supplier, po_number, pr_number, project_number, job_number, do_number,
          date, delivery_date, total_amount, page_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertDocument.run(
        data.id,
        data.originalName,
        data.renamedName,
        data.type,
        data.fileSize,
        data.filePath,
        data.status,
        data.supplier,
        data.poNumber,
        data.extractedData?.prNumber || data.prNumber || null,
        data.projectNumber,
        data.extractedData?.jobNumber || data.jobNumber || null,
        data.extractedData?.doNumber || data.doNumber || null,
        data.date,
        data.extractedData?.deliveryDate || null,
        data.extractedData?.totalAmount || null,
        data.extractedData?.pageCount || 1
      );

      // Insert document items if they exist
      if (data.extractedData?.items && data.extractedData.items.length > 0) {
        const insertItem = db.prepare(`
          INSERT INTO document_items (document_id, item_description, item_order, sn, part_number, quantity, uom)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        data.extractedData.items.forEach((item: any, index: number) => {
          // Handle both old string format and new object format
          if (typeof item === 'object') {
            insertItem.run(
              data.id,
              item.description || '',
              index,
              item.sn || null,
              item.partNumber || null,
              item.quantity || null,
              item.uom || null
            );
          } else {
            // Old string format - backward compatibility
            insertItem.run(data.id, item, index, null, null, null, null);
          }
        });
      }

      // Insert additional data if it exists
      if (data.extractedData) {
        const insertAdditionalData = db.prepare(`
          INSERT INTO document_additional_data (
            document_id, delivery_number, order_number, address, phone, email,
            document_number, delivery_terms, payment_terms, currency, total_quantity,
            your_reference, rc_number, gst_number, company_reg_no, fax, website,
            contact_person, shipping_method, special_instructions, discount,
            subtotal, tax_amount, document_type, extracted_numbers, extracted_codes,
            all_dates_found, all_amounts_found
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        insertAdditionalData.run(
          data.id,
          data.extractedData.deliveryNumber || null,
          data.extractedData.orderNumber || null,
          data.extractedData.address || null,
          data.extractedData.phone || null,
          data.extractedData.email || null,
          data.extractedData.documentNumber || null,
          data.extractedData.deliveryTerms || null,
          data.extractedData.paymentTerms || null,
          data.extractedData.currency || 'S$',
          data.extractedData.totalQuantity || null,
          data.extractedData.yourReference || null,
          data.extractedData.rcNumber || null,
          data.extractedData.gstNumber || null,
          data.extractedData.companyRegNo || null,
          data.extractedData.fax || null,
          data.extractedData.website || null,
          data.extractedData.contactPerson || null,
          data.extractedData.shippingMethod || null,
          data.extractedData.specialInstructions || null,
          data.extractedData.discount || null,
          data.extractedData.subtotal || null,
          data.extractedData.taxAmount || null,
          data.extractedData.documentType || null,
          data.extractedData.extractedNumbers || null,
          data.extractedData.extractedCodes || null,
          data.extractedData.allDatesFound || null,
          data.extractedData.allAmountsFound || null
        );
      }
    });

    // Execute transaction
    transaction(documentData);
    
    console.log('Document saved to database:', documentData.id);
    return documentData.id;
  } catch (error) {
    console.error('Error saving document to database:', error);
    throw error;
  }
};

export const getAllDocuments = async () => {
  try {
    const dbInstance = await getDatabase();
    if (!('prepare' in dbInstance)) {
      throw new Error('Prepare not supported with remote database');
    }
    const db = dbInstance as Database.Database;

    const query = db.prepare(`
      SELECT
        d.*,
        da.delivery_number, da.order_number, da.address, da.phone, da.email,
        da.document_number, da.delivery_terms, da.payment_terms, da.currency,
        da.total_quantity, da.your_reference, da.rc_number, da.gst_number,
        da.company_reg_no, da.fax, da.website, da.contact_person, da.shipping_method,
        da.special_instructions, da.discount, da.subtotal, da.tax_amount,
        da.document_type, da.extracted_numbers, da.extracted_codes,
        da.all_dates_found, da.all_amounts_found
      FROM documents d
      LEFT JOIN document_additional_data da ON d.id = da.document_id
      ORDER BY d.created_at DESC
    `);

    const rows = query.all() as DocumentRow[];

    // Get items separately for each document
    const itemsQuery = db.prepare(`
      SELECT sn, part_number, item_description, quantity, uom
      FROM document_items
      WHERE document_id = ?
      ORDER BY item_order
    `);

    // Transform the results to match the original format
    return rows.map((row: DocumentRow) => {
      const itemsRows = itemsQuery.all(row.id) as any[];
      const items = itemsRows.map((item: any) => {
        // If structured data exists, return object format
        if (item.part_number || item.quantity || item.uom) {
          return {
            sn: item.sn,
            partNumber: item.part_number,
            description: item.item_description,
            quantity: item.quantity,
            uom: item.uom
          };
        }
        // Otherwise return string format (backward compatibility)
        return item.item_description;
      });

      return {
        id: row.id,
        originalName: row.original_name,
        renamedName: row.renamed_name,
        type: row.file_type,
        fileSize: row.file_size,
        filePath: row.file_path,
        status: row.status,
        supplier: row.supplier,
        poNumber: row.po_number,
        prNumber: row.pr_number,
        projectNumber: row.project_number,
        jobNumber: row.job_number,
        doNumber: row.do_number,
        date: row.date,
        extractedData: {
          supplier: row.supplier,
          poNumber: row.po_number,
          prNumber: row.pr_number,
          projectNumber: row.project_number,
          jobNumber: row.job_number,
          doNumber: row.do_number,
          date: row.date,
          deliveryDate: row.delivery_date,
          totalAmount: row.total_amount,
          pageCount: row.page_count,
          items: items,
          deliveryNumber: row.delivery_number,
          orderNumber: row.order_number,
          address: row.address,
          phone: row.phone,
          email: row.email,
          documentNumber: row.document_number,
          deliveryTerms: row.delivery_terms,
          paymentTerms: row.payment_terms,
          currency: row.currency,
          totalQuantity: row.total_quantity,
          yourReference: row.your_reference,
          rcNumber: row.rc_number,
          gstNumber: row.gst_number,
          companyRegNo: row.company_reg_no,
          fax: row.fax,
          website: row.website,
          contactPerson: row.contact_person,
          shippingMethod: row.shipping_method,
          specialInstructions: row.special_instructions,
          discount: row.discount,
          subtotal: row.subtotal,
          taxAmount: row.tax_amount,
          documentType: row.document_type,
          extractedNumbers: row.extracted_numbers,
          extractedCodes: row.extracted_codes,
          allDatesFound: row.all_dates_found,
          allAmountsFound: row.all_amounts_found
        }
      };
    });
  } catch (error) {
    console.error('Error getting documents from database:', error);
    return [];
  }
};

export const getDocumentById = async (id: string) => {
  try {
    const dbInstance = await getDatabase();
    if (!('prepare' in dbInstance)) {
      throw new Error('Prepare not supported with remote database');
    }
    const db = dbInstance as Database.Database;

    const query = db.prepare(`
      SELECT
        d.*,
        da.delivery_number, da.order_number, da.address, da.phone, da.email,
        da.document_number, da.delivery_terms, da.payment_terms, da.currency,
        da.total_quantity, da.your_reference, da.rc_number, da.gst_number,
        da.company_reg_no, da.fax, da.website, da.contact_person, da.shipping_method,
        da.special_instructions, da.discount, da.subtotal, da.tax_amount,
        da.document_type, da.extracted_numbers, da.extracted_codes,
        da.all_dates_found, da.all_amounts_found
      FROM documents d
      LEFT JOIN document_additional_data da ON d.id = da.document_id
      WHERE d.id = ?
    `);

    const row = query.get(id) as DocumentRow | undefined;

    if (!row) return null;

    // Get items separately
    const itemsQuery = db.prepare(`
      SELECT sn, part_number, item_description, quantity, uom
      FROM document_items
      WHERE document_id = ?
      ORDER BY item_order
    `);

    const itemsRows = itemsQuery.all(id) as any[];
    const items = itemsRows.map((item: any) => {
      // If structured data exists, return object format
      if (item.part_number || item.quantity || item.uom) {
        return {
          sn: item.sn,
          partNumber: item.part_number,
          description: item.item_description,
          quantity: item.quantity,
          uom: item.uom
        };
      }
      // Otherwise return string format (backward compatibility)
      return item.item_description;
    });

    return {
      id: row.id,
      originalName: row.original_name,
      renamedName: row.renamed_name,
      type: row.file_type,
      fileSize: row.file_size,
      filePath: row.file_path,
      status: row.status,
      supplier: row.supplier,
      poNumber: row.po_number,
      prNumber: row.pr_number,
      projectNumber: row.project_number,
      jobNumber: row.job_number,
      doNumber: row.do_number,
      date: row.date,
      extractedData: {
        supplier: row.supplier,
        poNumber: row.po_number,
        prNumber: row.pr_number,
        projectNumber: row.project_number,
        jobNumber: row.job_number,
        doNumber: row.do_number,
        date: row.date,
        deliveryDate: row.delivery_date,
        totalAmount: row.total_amount,
        pageCount: row.page_count,
        items: items,
        deliveryNumber: row.delivery_number,
        orderNumber: row.order_number,
        address: row.address,
        phone: row.phone,
        email: row.email,
        documentNumber: row.document_number,
        deliveryTerms: row.delivery_terms,
        paymentTerms: row.payment_terms,
        currency: row.currency,
        totalQuantity: row.total_quantity,
        yourReference: row.your_reference,
        rcNumber: row.rc_number,
        gstNumber: row.gst_number,
        companyRegNo: row.company_reg_no,
        fax: row.fax,
        website: row.website,
        contactPerson: row.contact_person,
        shippingMethod: row.shipping_method,
        specialInstructions: row.special_instructions,
        discount: row.discount,
        subtotal: row.subtotal,
        taxAmount: row.tax_amount,
        documentType: row.document_type,
        extractedNumbers: row.extracted_numbers,
        extractedCodes: row.extracted_codes,
        allDatesFound: row.all_dates_found,
        allAmountsFound: row.all_amounts_found
      }
    };
  } catch (error) {
    console.error('Error getting document by ID from database:', error);
    return null;
  }
};

export const deleteDocument = async (id: string) => {
  try {
    const dbInstance = await getDatabase();
    if (!('prepare' in dbInstance)) {
      throw new Error('Prepare not supported with remote database');
    }
    const db = dbInstance as Database.Database;

    const deleteQuery = db.prepare('DELETE FROM documents WHERE id = ?');
    const result = deleteQuery.run(id);
    
    console.log('Document deleted from database:', id);
    return result.changes > 0;
  } catch (error) {
    console.error('Error deleting document from database:', error);
    throw error;
  }
};

// Close database connection
export const closeDatabase = () => {
  if (db) {
    db.close();
    console.log('Database connection closed');
  }
};

// Handle graceful shutdown
process.on('exit', closeDatabase);
process.on('SIGINT', closeDatabase);
process.on('SIGTERM', closeDatabase);