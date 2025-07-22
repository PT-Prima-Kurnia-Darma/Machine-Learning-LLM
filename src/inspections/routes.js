// File: src/inspections/routes.js
'use strict';

const handler = require('./handler');

module.exports = [
    {
        method: 'POST',
        path: '/llm-generate', 
        handler: handler.postInspectionHandler,
    }
];