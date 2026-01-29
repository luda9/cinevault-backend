# 🎬 Cinevault – Backend API

Backend API for **Cinevault**, a personal movie database and comparison application.

This service acts as a proxy to the OMDb API and provides persistent storage for:
- User watchlists
- Movie comparisons
- Recent comparisons history

Built as part of the *Personal Movie DB* take-home assignment.

---

## 🚀 Tech Stack

- Node.js
- Koa
- MySQL
- Axios
- Joi (request validation)
- mysql2
- dotenv

---

## 🌐 Environment Variables

Create a `.env` file in the project root:
```env
PORT=1337
OMDB_API_KEY=your_omdb_api_key
CLIENT_URL=http://localhost:5173
```

---

## 🗄 Database Setup (MySQL)

This API requires a MySQL database.

### 1️⃣ Create database
```sql
CREATE DATABASE cinevault;
USE cinevault;
```

### 2️⃣ Tables

#### Watchlist
```sql
CREATE TABLE watchlist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  imdb_id VARCHAR(20) NOT NULL UNIQUE,
  my_rating INT NULL,
  watched BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Comparisons
```sql
CREATE TABLE comparisons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  imdb_ids JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 🔌 Database Connection

The API connects to MySQL using `mysql2`:
```javascript
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'cinevault',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;
```

---

## 📡 API Endpoints

### 🔍 Search Movies

**`GET /api/search?s=batman`**

* Proxies OMDb search
* Validates query parameters
* Enriches results with watchlist status

### 🎥 Movie Details

**`GET /api/movie/:imdbId`**

* Validates IMDb ID format
* Returns full OMDb movie data

### ⭐ Watchlist

#### Add movies
```
POST /api/watchlist
```

#### Get watchlist
```
GET /api/watchlist
```

Supports:
* Sorting
* Filtering
* Watched status

#### Get single watchlist item
```
GET /api/watchlist/:imdbId
```

#### Update rating or watched status
```
PATCH /api/watchlist/:imdbId
```

#### Remove from watchlist
```
DELETE /api/watchlist/:imdbId
```

### 🔄 Movie Comparison

#### Create comparison
```
POST /api/compare
```

**Rules:**
* 2 to 5 movies
* Unique IMDb IDs
* Valid IMDb format

**Returns:**
* Comparison metrics
* Ratings summary
* Runtime and release year analysis

#### Recent comparisons
```
GET /api/comparisons/recent
```

* Returns the 10 most recent comparisons
* Used for frontend carousel display

---

## ▶️ Running the API

Install dependencies:
```bash
npm install
```

Start the server:
```bash
npm run dev
```

The API will run at: `http://localhost:1337`

---

## 🔐 Design Notes

* Strict IMDb ID validation
* Defensive handling of OMDb failures
* Prevents duplicate comparisons
* Clean separation between routes, validation and DB logic
* Fully aligned with the assignment requirements

---

## 👤 Author

Created by **Luda**  
🌐 [https://luda9.com](https://luda9.com)
