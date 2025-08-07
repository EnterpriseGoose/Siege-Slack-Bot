FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm
RUN pnpm install --frozen-lockfile

# Copy application code
COPY . .

# Create directory for data persistence
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Start the application
CMD ["pnpm", "start"] 