#!/bin/bash

echo "Starting Colizeum Tower Game Server..."
echo ""

if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
    echo ""
fi

echo "Starting server..."
node server.js



