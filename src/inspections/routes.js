// File: src/inspections/routes.js
'use strict';

const handler = require('./handler');

module.exports = [
    {
        method: 'POST',
        path: '/llm-generate', // hapi convention is lowercase
        handler: handler.postInspectionHandler,
    }
];