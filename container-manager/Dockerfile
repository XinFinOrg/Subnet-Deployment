# Use the official Node.js 18.15 image as the base
FROM node:18.15

# Install Docker CLI (required to interact with the Docker API)
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://get.docker.com | sh

# # Optionally, switch to a non-root user (for testing permissions)
# RUN useradd -m myuser
# USER myuser

COPY /src /app

# Set the working directory
WORKDIR /app

RUN npm install

# CMD ["sleep", "infinity"]
CMD ["npm", "run", "start"]