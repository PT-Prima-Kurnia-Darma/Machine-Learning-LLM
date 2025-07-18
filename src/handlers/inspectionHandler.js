// File: handlers/inspectionHandler.js

'use strict';

const inspectionService = require('../services/inspectionService'); // <-- INI PERBAIKANNYA

async function postInspectionHandler(request, h) {
    try {
        // 1. Ambil data dari request
        const inspectionInput = request.payload;

        // 2. Panggil service untuk melakukan pekerjaan
        const result = await inspectionService.generateReport(inspectionInput);

        // 3. Kirim hasil sukses kembali ke client
        return h.response(result).code(200);

    } catch (error) {
        // Jika terjadi error di service, kirim response error
        console.error('(Handler) Caught error:', error.message);
        return h.response({
            message: 'Internal Server Error.',
            error: error.message,
        }).code(500);
    }
}

module.exports = { postInspectionHandler };