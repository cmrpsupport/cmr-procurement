import { RequestHandler } from "express";
import { prisma } from "../lib/db";

// Create a new BOM file record
export const createBOMFile: RequestHandler = async (req, res) => {
  try {
    const { fileName, fileSize, totalItems, suppliersFound, processingTime } = req.body;
    
    const bomFile = await prisma.bOMFile.create({
      data: {
        fileName,
        fileSize,
        totalItems,
        suppliersFound,
        processingTime,
        status: "completed",
        processedAt: new Date()
      }
    });

    res.json(bomFile);
  } catch (error) {
    console.error('Error creating BOM file:', error);
    res.status(500).json({ error: 'Failed to create BOM file record' });
  }
};

// Create BOM items for a file
export const createBOMItems: RequestHandler = async (req, res) => {
  try {
    const { bomFileId, items } = req.body;
    
    const bomItems = await prisma.bOMItem.createMany({
      data: items.map((item: any) => ({
        bomFileId,
        partNumber: item.partNumber,
        description: item.description,
        quantity: item.quantity,
        supplier: item.supplier,
        symbol: item.symbol,
        category: item.category,
        remarks: item.remarks,
        unitPrice: item.unitPrice || 0,
        totalPrice: item.totalPrice || 0,
        rowIndex: item.rowIndex
      }))
    });

    res.json(bomItems);
  } catch (error) {
    console.error('Error creating BOM items:', error);
    res.status(500).json({ error: 'Failed to create BOM items' });
  }
};

// Get all BOM files
export const getBOMFiles: RequestHandler = async (req, res) => {
  try {
    const bomFiles = await prisma.bOMFile.findMany({
      include: {
        bomItems: true,
        purchaseReqs: true
      },
      orderBy: {
        uploadedAt: 'desc'
      }
    });

    res.json(bomFiles);
  } catch (error) {
    console.error('Error fetching BOM files:', error);
    res.status(500).json({ error: 'Failed to fetch BOM files' });
  }
};

// Get BOM file by ID with items
export const getBOMFileById: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    
    const bomFile = await prisma.bOMFile.findUnique({
      where: { id },
      include: {
        bomItems: true,
        purchaseReqs: {
          include: {
            items: true
          }
        }
      }
    });

    if (!bomFile) {
      return res.status(404).json({ error: 'BOM file not found' });
    }

    res.json(bomFile);
  } catch (error) {
    console.error('Error fetching BOM file:', error);
    res.status(500).json({ error: 'Failed to fetch BOM file' });
  }
};
