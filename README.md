# AR Interior Design App

A comprehensive AR-based interior design application that allows users to visualize furniture and design elements in their real-world space using augmented reality.

## Local AI/ML conversion

The design flow now uses an Express constraint-based placement engine with a private Python service for pretrained OWLv2 room-object detection and a client-trained XGBoost layout ranker. Gemini is no longer used by runtime controllers. When no trained ranker is configured, generation uses geometric scoring and reports that mode explicitly.

The client dataset is not available yet. Built-in furniture dimensions and PHP prices are examples; supply the client catalog before relying on estimates. Detection produces 2D image boxes; accurate spatial mapping and stable AR anchors still need native AR integration.

See [ML service setup, catalog schema and ranker training](ml-service/README.md). Start Python separately from `npm run dev`. Copy `backend/.env.example` and `frontend/.env.example` into their respective `.env` files, and use your computer's LAN IP in the frontend API URLs when testing on a phone.

## 📁 Project Structure

```
ARInteriorDesignApp/
├── backend/              # Node.js backend API
│   ├── src/
│   │   ├── controllers/  # API controllers
│   │   ├── routes/       # API routes
│   │   ├── middleware/   # Express middleware
│   │   ├── db/          # Database configuration
│   │   └── server.js    # Server entry point
│   └── package.json
│
├── frontend/            # React Native mobile app
│   ├── app/            # Expo Router pages
│   ├── components/     # Reusable components
│   ├── services/       # API and business logic services
│   ├── hooks/          # Custom React hooks
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions
│   ├── assets/         # Images, fonts, etc.
│   └── package.json
│
└── docs/               # Project documentation
    ├── 3D_MODELS_GUIDE.md
    ├── UNITY_INTEGRATION.md
    ├── SYSTEM_FLOW_DIAGRAM.md
    └── ...
```

## 🚀 Getting Started

### Prerequisites

- Node.js 22.8 or higher (Node 24 recommended for the current test scripts)
- npm or yarn
- Expo CLI
- MongoDB (for backend)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd ARInteriorDesignApp
   ```

2. **Install all dependencies**
   ```bash
   npm run install:all
   ```

   Or install individually:
   ```bash
   # Install root dependencies
   npm install

   # Install frontend dependencies
   cd frontend
   npm install

   # Install backend dependencies
   cd ../backend
   npm install
   ```

### Running the Application

#### Run Frontend Only
```bash
npm run start:frontend
```

#### Run Backend Only
```bash
npm run start:backend
```

#### Run Both Concurrently
```bash
npm run dev
```

## 📱 Features

- **AR Visualization**: Place and visualize furniture in real-world spaces
- **AI-Powered Design**: Get intelligent design recommendations
- **3D Layout**: Create and edit 3D room layouts
- **Theme Recommendations**: AI-generated theme suggestions based on preferences
- **Spatial Mapping**: Advanced room scanning and mapping
- **Project Management**: Save and manage multiple design projects
- **User Profiles**: Personalized user experience and preferences

## 🛠️ Tech Stack

### Frontend
- React Native with Expo
- TypeScript
- AR capabilities (ARKit/ARCore)
- Unity3D integration for 3D rendering

### Backend
- Node.js
- Express.js
- MongoDB
- RESTful API
- Private Python/FastAPI service for OWLv2 detection and XGBoost layout ranking

## 📚 Documentation

Detailed documentation can be found in the `/docs` folder:

- [Getting Started Guide](frontend/GETTING_STARTED.md)
- [3D Models Setup](docs/3D_MODELS_GUIDE.md)
- [Unity Integration](docs/UNITY_INTEGRATION.md)
- [System Architecture](docs/HOW_THE_SYSTEM_WORKS.md)
- [Database Schema](docs/MONGODB_DOCUMENT_MODEL.md)

## 🧪 Testing

```bash
# Run frontend tests
cd frontend
npm test
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📧 Contact

For questions or support, please open an issue in the repository.

