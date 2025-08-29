# CMR Procurement System

A comprehensive procurement management system built with React, Express, and TypeScript. This application provides tools for ERP report processing, document analysis, and purchase requisition generation.

## 🚀 Features

### 📊 Report Builder
- **ERP File Processing**: Upload and process ERP reports (XLSX, XLS, CSV)
- **Template Mapping**: Transform ERP data to enhanced report format
- **Smart Data Extraction**: Automatically extract PR numbers, Work Order numbers, and item details
- **Download Enhanced Reports**: Generate and download processed reports as CSV

### 📄 Document Assistant
- **OCR Processing**: Extract text from images and PDFs using Tesseract.js
- **Multi-format Support**: Handle PNG, JPG, PDF files
- **Data Extraction**: Parse supplier info, PO numbers, dates, and amounts
- **Real-time Processing**: Process documents with progress tracking

### 📋 Purchase Requisition Generator
- **Multi-step Workflow**: Guided PR creation process
- **File Upload**: Support for various document formats
- **Status Tracking**: Track PR approval status
- **Template-based Generation**: Generate standardized PR documents

### 🎨 Modern UI/UX
- **Dark/Light Mode**: Toggle between themes
- **Responsive Design**: Works on desktop and mobile
- **Modern Components**: Built with Radix UI and TailwindCSS
- **Intuitive Interface**: Clean, user-friendly design

## 🛠️ Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: Express.js + Node.js
- **UI Components**: Radix UI + Lucide React icons
- **File Processing**: XLSX library, Tesseract.js (OCR)
- **Database**: Prisma ORM with PostgreSQL
- **Package Manager**: PNPM

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd cmr-procurement
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your database and API keys
   ```

4. **Set up database**
   ```bash
   pnpm prisma generate
   pnpm prisma db push
   ```

5. **Start development server**
   ```bash
   pnpm dev
   ```

## 🚀 Usage

### Report Builder
1. Upload your ERP report file (XLSX, XLS, CSV)
2. Upload or use a saved template
3. Review the processed data
4. Download the enhanced report

### Document Assistant
1. Upload an image or PDF document
2. Wait for OCR processing
3. Review extracted data
4. Use the extracted information

### Purchase Requisition Generator
1. Follow the step-by-step workflow
2. Upload required documents
3. Fill in PR details
4. Generate and download the PR

## 📁 Project Structure

```
├── client/                 # React frontend
│   ├── pages/             # Route components
│   ├── components/        # UI components
│   └── App.tsx           # Main app component
├── server/                # Express backend
│   ├── routes/           # API endpoints
│   └── index.ts          # Server setup
├── shared/               # Shared types
└── prisma/              # Database schema
```

## 🔧 Development Commands

```bash
pnpm dev          # Start development server
pnpm build        # Build for production
pnpm start        # Start production server
pnpm typecheck    # TypeScript validation
pnpm test         # Run tests
```

## 🌐 Deployment

### Vercel (Recommended)
1. Connect your GitHub repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to main branch

### Netlify
1. Connect your GitHub repository to Netlify
2. Set build command: `pnpm build`
3. Set publish directory: `dist`
4. Configure environment variables

### Railway/Render
1. Connect your GitHub repository
2. Set build command: `pnpm install && pnpm build`
3. Set start command: `pnpm start`
4. Configure environment variables

## 📝 Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/cmr_procurement"

# API Keys (if needed)
API_KEY="your-api-key"

# Server Configuration
PORT=8080
NODE_ENV=production
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions, please open an issue on GitHub or contact the development team.
