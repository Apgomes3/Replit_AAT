"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const http_proxy_middleware_1 = require("http-proxy-middleware");
dotenv_1.default.config();
const auth_1 = __importDefault(require("./routes/auth"));
const projects_1 = __importDefault(require("./routes/projects"));
const products_1 = __importDefault(require("./routes/products"));
const knowledge_1 = __importDefault(require("./routes/knowledge"));
const documents_1 = __importDefault(require("./routes/documents"));
const graph_1 = __importDefault(require("./routes/graph"));
const search_1 = __importDefault(require("./routes/search"));
const import_1 = __importDefault(require("./routes/import"));
const admin_1 = __importDefault(require("./routes/admin"));
const purchaseOrders_1 = __importDefault(require("./routes/purchaseOrders"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const designBooks_1 = __importDefault(require("./routes/designBooks"));
const lssCompactUnits_1 = __importDefault(require("./routes/lssCompactUnits"));
const speciesCatalog_1 = __importDefault(require("./routes/speciesCatalog"));
const biologicalMedia_1 = __importDefault(require("./routes/biologicalMedia"));
const pumpSelections_1 = __importDefault(require("./routes/pumpSelections"));
const frictionLoss_1 = __importDefault(require("./routes/frictionLoss"));
const uvEngineering_1 = __importStar(require("./routes/uvEngineering"));
const errors_1 = require("./middleware/errors");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, helmet_1.default)({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));
app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use((req, _res, next) => { if (req.body === undefined)
    req.body = {}; next(); });
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads')));
app.use('/api/v1/auth', auth_1.default);
app.use('/api/v1', projects_1.default);
app.use('/api/v1', products_1.default);
app.use('/api/v1', knowledge_1.default);
app.use('/api/v1', documents_1.default);
app.use('/api/v1/graph', graph_1.default);
app.use('/api/v1/search', search_1.default);
app.use('/api/v1/import', import_1.default);
app.use('/api/v1/admin', admin_1.default);
app.use('/api/v1/admin/uv-engineering', uvEngineering_1.default);
app.use('/api/v1', uvEngineering_1.uvEngineeringConsumerRoutes);
app.use('/api/v1', purchaseOrders_1.default);
app.use('/api/v1', notifications_1.default);
app.use('/api/v1', designBooks_1.default);
app.use('/api/v1', lssCompactUnits_1.default);
app.use('/api/v1', speciesCatalog_1.default);
app.use('/api/v1', biologicalMedia_1.default);
app.use('/api/v1', pumpSelections_1.default);
app.use('/api/v1', frictionLoss_1.default);
app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.use('/', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: 'http://localhost:5000',
    changeOrigin: true,
    ws: true,
}));
app.use(errors_1.notFound);
app.use(errors_1.errorHandler);
app.listen(PORT, () => {
    console.log(`EDP API running on port ${PORT}`);
});
exports.default = app;
