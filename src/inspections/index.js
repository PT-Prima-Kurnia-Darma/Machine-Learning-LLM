// File: src/inspections/index.js
'use strict';

const routes = require('./routes');
const pkg = require('../../package.json'); // good practice to get name and version from package.json

module.exports = {
    name: 'inspectionsPlugin',
    version: pkg.version,
    register: async (server) => {
        // register all routes for this plugin
        server.route(routes);
    }
};