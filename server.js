// File: server.js

'use strict';

const Hapi = require('@hapi/hapi');
require('dotenv').config();

const inspectionHandler = require('./src/inspectionHandler'); // Hapus '/handlers' dari path

const init = async () => {
    const server = Hapi.server({
        port: process.env.PORT || 3000,
        host: '0.0.0.0',
    });

    // Daftarkan rute, panggil handler dari file terpisah
    server.route({
        method: 'POST',
        path: '/LLM-generate',
        handler: inspectionHandler.postInspectionHandler,
    });

    await server.start();
    console.log(`✅ Server running on ${server.info.uri}`);
    console.log(`Using Project: ${process.env.GCP_PROJECT_ID} in Region: ${process.env.GCP_LOCATION}`);
    console.log(`Using Model: ${process.env.GCP_MODEL_NAME || 'gemini-2.5-flash'}`);
};

// Graceful shutdown logic
process.on('SIGINT', async () => {
    console.log('Stopping server...');
    process.exit(0);
});

process.on('unhandledRejection', (err) => {
    console.error('An unhandled promise rejection occurred:', err);
    process.exit(1);
});

init();