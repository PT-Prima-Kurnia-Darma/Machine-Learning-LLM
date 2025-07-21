// File: src/inspections/handler.js
'use strict';

const service = require('./service');

async function postInspectionHandler(request, h) {
    try {
        // 1. get data from request
        const inspectionInput = request.payload;

        // 2. call service to do the business logic
        const result = await service.generateReport(inspectionInput);

        // 3. send success response back to client
        return h.response(result).code(200);

    } catch (error) {
        // if service throws an error, send error response
        console.error('(Handler) Caught error:', error.message);
        return h.response({
            message: 'Internal Server Error.',
            error: error.message,
        }).code(500);
    }
}

module.exports = { postInspectionHandler };