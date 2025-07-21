// File: server.js
'use strict';

const Hapi = require('@hapi/hapi');
require('dotenv').config();

// import the entire inspections plugin
const inspectionsPlugin = require('./src/inspections'); 

const init = async () => {
    const server = Hapi.server({
        port: process.env.PORT || 3000,
        host: '0.0.0.0',
    });

    // register the inspections plugin
    // Hapi will handle loading its routes, handlers, etc.
    await server.register(inspectionsPlugin);

    await server.start();
    console.log(`✅ Server running on ${server.info.uri}`);
    console.log(`Using Project: ${process.env.GCP_PROJECT_ID} in Region: ${process.env.GCP_LOCATION}`);
    console.log(`Using Model: ${process.env.GCP_MODEL_NAME || 'gemini-2.5-flash'}`);
};

// graceful shutdown logic
process.on('SIGINT', async () => {
    console.log('Stopping server...');
    process.exit(0);
});

process.on('unhandledRejection', (err) => {
    console.error('An unhandled promise rejection occurred:', err);
    process.exit(1);
});

init();