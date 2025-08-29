import { RequestHandler } from "express";
import { prisma } from "../lib/db";

// Create purchase requisitions from BOM items
export const createPurchaseRequisitions: RequestHandler = async (req, res) => {
  try {
    const { bomFileId, purchaseRequisitions } = req.body;
    
    const createdPRs = [];
    
    for (const pr of purchaseRequisitions) {
      const createdPR = await prisma.purchaseRequisition.create({
        data: {
          prNumber: pr.prNumber,
          supplier: pr.supplier,
          totalItems: pr.totalItems,
          totalValue: pr.totalValue,
          status: pr.status,
          bomFileId,
          items: {
            create: pr.items.map((item: any) => ({
              partNumber: item.partNumber,
              description: item.description,
              quantity: item.quantity,
              symbol: item.symbol,
              category: item.category,
              remarks: item.remarks,
              unitPrice: item.unitPrice || 0,
              totalPrice: item.totalPrice || 0
            }))
          }
        },
        include: {
          items: true
        }
      });
      
      createdPRs.push(createdPR);
    }

    res.json(createdPRs);
  } catch (error) {
    console.error('Error creating purchase requisitions:', error);
    res.status(500).json({ error: 'Failed to create purchase requisitions' });
  }
};

// Get all purchase requisitions
export const getPurchaseRequisitions: RequestHandler = async (req, res) => {
  try {
    const prs = await prisma.purchaseRequisition.findMany({
      include: {
        items: true,
        bomFile: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json(prs);
  } catch (error) {
    console.error('Error fetching purchase requisitions:', error);
    res.status(500).json({ error: 'Failed to fetch purchase requisitions' });
  }
};

// Update purchase requisition
export const updatePurchaseRequisition: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { supplier, totalItems, totalValue, status, items } = req.body;
    
    // Update the PR and its items
    const updatedPR = await prisma.purchaseRequisition.update({
      where: { id },
      data: {
        supplier,
        totalItems,
        totalValue,
        status,
        items: {
          deleteMany: {}, // Delete existing items
          create: items.map((item: any) => ({
            partNumber: item.partNumber,
            description: item.description,
            quantity: item.quantity,
            symbol: item.symbol,
            category: item.category,
            remarks: item.remarks,
            unitPrice: item.unitPrice || 0,
            totalPrice: item.totalPrice || 0
          }))
        }
      },
      include: {
        items: true
      }
    });

    res.json(updatedPR);
  } catch (error) {
    console.error('Error updating purchase requisition:', error);
    res.status(500).json({ error: 'Failed to update purchase requisition' });
  }
};

// Delete purchase requisition
export const deletePurchaseRequisition: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    
    await prisma.purchaseRequisition.delete({
      where: { id }
    });

    res.json({ message: 'Purchase requisition deleted successfully' });
  } catch (error) {
    console.error('Error deleting purchase requisition:', error);
    res.status(500).json({ error: 'Failed to delete purchase requisition' });
  }
};
