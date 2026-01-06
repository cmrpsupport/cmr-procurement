# Use Node.js 18 base image
FROM node:18

# Install ImageMagick, Ghostscript, and Poppler for PDF processing
RUN apt-get update && apt-get install -y \
    imagemagick \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy project files
COPY . .

# Build the application
RUN npm run build

# Expose port (Render uses PORT env variable)
EXPOSE 10000

# Start the application
CMD ["npm", "start"]
