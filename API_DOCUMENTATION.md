# Home Service Management Backend - API Documentation

> **Version:** 1.0.0
> **Base URL:** `http://localhost:5000/api` (configure via `BASE_URL` in .env)
> **Documentation Generated:** 2026-02-20

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Database Schema](#database-schema)
4. [Authentication](#authentication)
5. [API Routes](#api-routes)
   - [Authentication Routes](#authentication-routes)
   - [User Management](#user-management)
   - [Business Management](#business-management)
   - [Category Management](#category-management)
   - [Service Management](#service-management)
   - [Slot Management](#slot-management)
   - [Address Management](#address-management)
   - [Booking Management](#booking-management)
   - [Feedback Management](#feedback-management)
6. [Error Handling](#error-handling)
7. [Validation Rules](#validation-rules)
8. [Response Formats](#response-formats)

---

## Project Overview

A comprehensive home service management platform that connects customers with service providers. The system supports three user roles:

- **Customer (roleId: 1)**: Can browse services, book appointments, manage addresses, and leave feedback
- **Provider (roleId: 2)**: Can manage business profiles, services, time slots, and handle bookings
- **Admin (roleId: 3)**: Full system administration including user management, category management, and business verification

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| **Framework** | Express.js (Node.js) |
| **Database** | PostgreSQL |
| **ORM** | Drizzle ORM |
| **Authentication** | JWT (JSON Web Tokens) |
| **Token Storage** | httpOnly Cookies |
| **Validation** | Yup |
| **Password Hashing** | bcryptjs |
| **CORS** | Enabled (credentials: true) |

---

## Database Schema

### Entity Relationship Overview

```
Users (1) ----< (N) Addresses
Users (1) ----< (1) Business Profile
Users (1) ----< (N) Bookings (as customer)
Users (1) ----< (N) Bookings (as provider via business)

Roles (1) ----< (N) Users

Categories (1) ----< (N) Business Profiles

Business Profiles (1) ----< (N) Services
Business Profiles (1) ----< (N) Slots
Business Profiles (1) ----< (N) Bookings

Services (1) ----< (N) Bookings
Slots (1) ----< (N) Bookings
Addresses (1) ----< (N) Bookings
Bookings (1) ----< (1) Feedback
```

### Tables

#### 1. Users Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| name | varchar(255) | NOT NULL | User's full name |
| email | varchar(255) | UNIQUE, NOT NULL | User's email address |
| phone | varchar(20) | NOT NULL | Contact number (10 digits) |
| password | varchar(255) | NOT NULL | Hashed password |
| role_id | integer | DEFAULT: 1, FK → roles.id | User role (1=customer, 2=provider, 3=admin) |
| created_at | timestamp | DEFAULT: NOW() | Account creation timestamp |

#### 2. Roles Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| name | role_type (enum) | UNIQUE | Role name: customer, provider, admin |
| description | varchar(255) | | Role description |

**Role Values:**
- `customer` - Regular users who book services
- `provider` - Service providers who offer services
- `admin` - System administrators

#### 3. Address Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| user_id | integer | FK → users.id (CASCADE) | Owner of the address |
| address_type | address_type (enum) | DEFAULT: 'home' | Type: home, work, billing, shipping, other |
| street | varchar(255) | NOT NULL | Street address |
| city | varchar(100) | NOT NULL | City name |
| state | varchar(100) | NOT NULL | State/region |
| zip_code | varchar(20) | NOT NULL | Postal code (6 digits) |
| is_default | boolean | DEFAULT: false | Default address flag |

#### 4. Categories Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| name | varchar(255) | UNIQUE, NOT NULL | Category name |
| description | varchar(1000) | | Category description |
| created_at | timestamp | DEFAULT: NOW() | Creation timestamp |

#### 5. Business Profiles Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| provider_id | integer | FK → users.id (CASCADE) | Provider/owner user ID |
| category_id | integer | FK → categories.id (SET NULL) | Business category |
| business_name | varchar(255) | NOT NULL | Name of the business |
| description | varchar(1000) | | Business description |
| phone | varchar(20) | NOT NULL | Business contact number |
| website | varchar(255) | | Business website URL |
| rating | numeric(3,2) | | Average rating (0.00-5.00) |
| is_verified | boolean | DEFAULT: false | Admin verification status |
| created_at | timestamp | DEFAULT: NOW() | Profile creation timestamp |

#### 6. Services Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| business_profile_id | integer | FK → business_profiles.id (CASCADE) | Owner business ID |
| name | varchar(255) | NOT NULL | Service name |
| description | varchar(1000) | | Service description |
| price | integer | NOT NULL | Price in local currency (paisa/cents) |
| EstimateDuration | integer | NOT NULL | Duration in minutes |
| is_active | boolean | DEFAULT: true | Service availability status |
| created_at | timestamp | DEFAULT: NOW() | Creation timestamp |

#### 7. Slots Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| business_profile_id | integer | FK → business_profiles.id (CASCADE) | Business ID |
| start_time | time | NOT NULL | Available start time (HH:mm:ss) |
| end_time | time | NOT NULL | Available end time (HH:mm:ss) |
| created_at | timestamp | DEFAULT: NOW() | Creation timestamp |

#### 8. Bookings Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| customer_id | integer | FK → users.id (CASCADE) | Customer user ID |
| business_profile_id | integer | FK → business_profiles.id (RESTRICT) | Booked business ID |
| service_id | integer | FK → services.id (RESTRICT) | Booked service ID |
| slot_id | integer | FK → slots.id (RESTRICT) | Booked time slot ID |
| address_id | integer | FK → address.id (RESTRICT) | Service address ID |
| booking_date | timestamp | DEFAULT: NOW() | When booking was created |
| status | booking_status (enum) | DEFAULT: 'pending' | Status: pending, confirmed, completed, cancelled |
| total_price | integer | NOT NULL | Total booking price |

**Booking Status Flow:**
```
pending → confirmed → completed
   ↓
cancelled
```

#### 9. Feedback Table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | serial | PRIMARY KEY | Auto-increment ID |
| booking_id | integer | FK → bookings.id (CASCADE) | Related booking ID |
| rating | numeric(2,1) | NOT NULL | Rating from 1.0 to 5.0 |
| comments | varchar(2000) | | Customer comments |
| created_at | timestamp | DEFAULT: NOW() | Feedback timestamp |

---

## Authentication

### Authentication Method

The API uses **JWT (JSON Web Tokens)** stored in **httpOnly cookies** for secure authentication.

### Cookie Details

- **Name:** `token`
- **Type:** httpOnly, secure (in production)
- **Storage:** Automatically sent by browser with requests
- **Login:** Cookie is set by server on successful login
- **Logout:** Cookie is cleared by server

### Authentication Flow

```
1. POST /api/login → Server validates credentials
2. Server generates JWT token
3. Server sets httpOnly cookie with token
4. Client includes cookie automatically in subsequent requests
5. Middleware validates token on protected routes
```

### Protected Routes

Routes requiring authentication are marked with 🔒 in the documentation.

### Role-Based Access Control

| Role ID | Role | Access Level |
|---------|------|--------------|
| 1 | Customer | Book services, manage addresses, submit feedback |
| 2 | Provider | Manage business, services, slots, handle bookings |
| 3 | Admin | Full system access, verify businesses, manage users/categories |

---

## API Routes

### Base URL
```
http://localhost:8000
```

**Note:** All routes are mounted directly at the root level. No `/api` prefix is used.

---

### Authentication Routes

#### Register New User

```http
POST /register
```

**Description:** Create a new user account

**Authentication:** None (Public)

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john.doe@example.com",
  "phone": "9876543210",
  "password": "password123",
  "roleId": 1
}
```

**Validation Rules:**
- `name`: 3-50 characters
- `email`: Valid email format
- `phone`: 10 digits, must start with 6-9
- `password`: 6-30 characters
- `roleId`: Optional (defaults to 1 = Customer)

**Success Response (201 Created):**
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john.doe@example.com",
  "phone": "9876543210",
  "role_id": 1,
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request` - Validation errors
  ```json
  {
    "message": "Validation failed",
    "errors": ["Email is required", "Phone must be 10 digits"]
  }
  ```
- `409 Conflict` - Email already exists
  ```json
  {
    "message": "User with this email already exists"
  }
  ```

---

#### User Login

```http
POST /login
```

**Description:** Authenticate user and receive JWT token

**Authentication:** None (Public)

**Request Body:**
```json
{
  "email": "john.doe@example.com",
  "password": "password123"
}
```

**Success Response (200 OK):**
```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "john.doe@example.com",
    "role_id": 1
  }
}
```

**Note:** JWT token is automatically set in httpOnly cookie named `token`

**Error Responses:**
- `400 Bad Request` - Invalid credentials
  ```json
  {
    "message": "Invalid email or password"
  }
  ```

---

#### User Logout

```http
POST /logout
```

**Description:** Clear authentication cookie

**Authentication:** Required 🔒

**Success Response (200 OK):**
```json
{
  "message": "Logout successful"
}
```

---

### User Management

#### Get All Users

```http
GET /users
```

**Description:** Get list of all users (Admin only)

**Authentication:** Required 🔒
**Authorization:** Admin only (roleId: 3)

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "name": "John Doe",
    "email": "john.doe@example.com",
    "phone": "9876543210",
    "role_id": 1,
    "created_at": "2026-02-20T10:00:00.000Z"
  }
]
```

---

#### Get User by ID

```http
GET /users/:id
```

**Description:** Get specific user details

**Authentication:** Required 🔒

**URL Parameters:**
- `id` (path) - User ID

**Success Response (200 OK):**
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john.doe@example.com",
  "phone": "9876543210",
  "role_id": 1,
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

**Error Responses:**
- `404 Not Found` - User not found

---

#### Get Current User Profile

```http
GET /user/profile
```

**Description:** Get currently authenticated user's profile

**Authentication:** Required 🔒

**Success Response (200 OK):**
```json
{
  "id": 1,
  "name": "John Doe",
  "email": "john.doe@example.com",
  "phone": "9876543210",
  "role_id": 1,
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

---

#### Update User Profile

```http
PUT /users
```

**Description:** Update current user's profile information

**Authentication:** Required 🔒

**Request Body:**
```json
{
  "name": "John Updated",
  "phone": "9876543211"
}
```

**Success Response (200 OK):**
```json
{
  "id": 1,
  "name": "John Updated",
  "email": "john.doe@example.com",
  "phone": "9876543211",
  "role_id": 1
}
```

---

#### Delete User

```http
DELETE /users/:id
```

**Description:** Delete a user account (Admin only)

**Authentication:** Required 🔒
**Authorization:** Admin only (roleId: 3)

**URL Parameters:**
- `id` (path) - User ID to delete

**Success Response (200 OK):**
```json
{
  "message": "User deleted successfully"
}
```

---

### Business Management

#### Get All Businesses

```http
GET /businesses
```

**Description:** Get list of all businesses (public endpoint)

**Authentication:** None (Public)

**Query Parameters:**
- `category` (optional) - Filter by category ID
- `verified` (optional) - Filter by verification status (true/false)

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "provider_id": 2,
    "business_name": "ABC Plumbing Services",
    "description": "Professional plumbing services",
    "category": {
      "id": 1,
      "name": "Plumbing"
    },
    "phone": "9876543210",
    "website": "https://abcplumbing.com",
    "rating": 4.5,
    "is_verified": true,
    "created_at": "2026-02-20T10:00:00.000Z"
  }
]
```

---

#### Get Business by ID

```http
GET /businesses/:id
```

**Description:** Get detailed business information including services and slots

**Authentication:** None (Public)

**URL Parameters:**
- `id` (path) - Business ID

**Success Response (200 OK):**
```json
{
  "id": 1,
  "provider_id": 2,
  "business_name": "ABC Plumbing Services",
  "description": "Professional plumbing services",
  "category": {
    "id": 1,
    "name": "Plumbing"
  },
  "phone": "9876543210",
  "website": "https://abcplumbing.com",
  "rating": 4.5,
  "is_verified": true,
  "services": [
    {
      "id": 1,
      "name": "Pipe Repair",
      "description": "Fix leaking pipes",
      "price": 50000,
      "EstimateDuration": 60,
      "is_active": true
    }
  ],
  "slots": [
    {
      "id": 1,
      "start_time": "09:00:00",
      "end_time": "10:00:00"
    }
  ],
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

**Error Responses:**
- `404 Not Found` - Business not found

---

#### Get Business by Provider ID

```http
GET /business/provider/:userId
```

**Description:** Get business profile for a specific provider

**Authentication:** None (Public)

**URL Parameters:**
- `userId` (path) - Provider's user ID

**Success Response (200 OK):**
```json
{
  "id": 1,
  "provider_id": 2,
  "business_name": "ABC Plumbing Services",
  "description": "Professional plumbing services",
  "phone": "9876543210",
  "rating": 4.5,
  "is_verified": true
}
```

---

#### Create Business

```http
POST /businesses
```

**Description:** Create a new business profile (Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**Request Body:**
```json
{
  "name": "ABC Plumbing Services",
  "description": "Professional plumbing services for residential and commercial properties",
  "categoryId": 1,
  "phone": "9876543210",
  "website": "https://abcplumbing.com"
}
```

**Validation Rules:**
- `name`: 3-100 characters
- `description`: 10-500 characters
- `categoryId`: Valid category ID
- `phone`: 10 digits
- `website`: Optional, valid URL if provided

**Success Response (201 Created):**
```json
{
  "id": 1,
  "provider_id": 2,
  "business_name": "ABC Plumbing Services",
  "description": "Professional plumbing services",
  "category_id": 1,
  "phone": "9876543210",
  "website": "https://abcplumbing.com",
  "rating": null,
  "is_verified": false,
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

---

#### Update Business

```http
PUT /businesses/:id
```

**Description:** Update business profile (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `id` (path) - Business ID

**Request Body:**
```json
{
  "name": "Updated Business Name",
  "description": "Updated description",
  "categoryId": 2,
  "phone": "9876543211",
  "website": "https://updatedsite.com"
}
```

**Success Response (200 OK):**
```json
{
  "id": 1,
  "business_name": "Updated Business Name",
  "description": "Updated description",
  "phone": "9876543211",
  "website": "https://updatedsite.com"
}
```

---

#### Verify Business

```http
PUT /businesses/verify/:id
```

**Description:** Verify a business (Admin only)

**Authentication:** Required 🔒
**Authorization:** Admin only (roleId: 3)

**URL Parameters:**
- `id` (path) - Business ID to verify

**Success Response (200 OK):**
```json
{
  "id": 1,
  "business_name": "ABC Plumbing Services",
  "is_verified": true
}
```

---

#### Delete Business

```http
DELETE /businesses/:id
```

**Description:** Delete business profile (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `id` (path) - Business ID

**Success Response (200 OK):**
```json
{
  "message": "Business deleted successfully"
}
```

---

### Category Management

#### Get All Categories

```http
GET /categories
```

**Description:** Get list of all service categories

**Authentication:** None (Public)

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "name": "Plumbing",
    "description": "Plumbing and pipe repair services",
    "created_at": "2026-02-20T10:00:00.000Z"
  },
  {
    "id": 2,
    "name": "Electrical",
    "description": "Electrical services and repairs",
    "created_at": "2026-02-20T10:00:00.000Z"
  }
]
```

---

#### Create Category

```http
POST /categories
```

**Description:** Create a new category (Admin only)

**Authentication:** Required 🔒
**Authorization:** Admin only (roleId: 3)

**Request Body:**
```json
{
  "name": "Cleaning",
  "description": "Home and office cleaning services"
}
```

**Success Response (201 Created):**
```json
{
  "id": 3,
  "name": "Cleaning",
  "description": "Home and office cleaning services",
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

---

#### Delete Category

```http
DELETE /categories/:id
```

**Description:** Delete a category (Admin only)

**Authentication:** Required 🔒
**Authorization:** Admin only (roleId: 3)

**URL Parameters:**
- `id` (path) - Category ID

**Success Response (200 OK):**
```json
{
  "message": "Category deleted successfully"
}
```

---

### Service Management

#### Get All Services

```http
GET /services
```

**Description:** Get list of all services across all businesses

**Authentication:** None (Public)

**Query Parameters:**
- `businessId` (optional) - Filter by business ID

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "business_profile_id": 1,
    "name": "Pipe Repair",
    "description": "Fix leaking pipes and faucets",
    "price": 50000,
    "EstimateDuration": 60,
    "is_active": true,
    "created_at": "2026-02-20T10:00:00.000Z"
  }
]
```

**Note:** `price` is in paisa/cents (divide by 100 for display)

---

#### Get Services by Business

```http
GET /services/business/:businessId
```

**Description:** Get all services offered by a specific business

**Authentication:** None (Public)

**URL Parameters:**
- `businessId` (path) - Business ID

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "name": "Pipe Repair",
    "description": "Fix leaking pipes and faucets",
    "price": 50000,
    "EstimateDuration": 60,
    "is_active": true
  },
  {
    "id": 2,
    "name": "Drain Cleaning",
    "description": "Professional drain cleaning service",
    "price": 80000,
    "EstimateDuration": 90,
    "is_active": true
  }
]
```

---

#### Create Service

```http
POST /services/:businessId
```

**Description:** Add a new service to a business (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `businessId` (path) - Business ID

**Request Body:**
```json
{
  "name": "Emergency Plumbing",
  "description": "24/7 emergency plumbing services",
  "price": 100000,
  "duration": 120
}
```

**Validation Rules:**
- `name`: Minimum 3 characters
- `description`: Minimum 10 characters
- `price`: Positive number, max 100000
- `duration`: Positive number (minutes), max 1440 (24 hours)

**Success Response (201 Created):**
```json
{
  "id": 3,
  "business_profile_id": 1,
  "name": "Emergency Plumbing",
  "description": "24/7 emergency plumbing services",
  "price": 100000,
  "EstimateDuration": 120,
  "is_active": true,
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

---

#### Update Service

```http
PUT /services/:serviceId
```

**Description:** Update service details (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `serviceId` (path) - Service ID

**Request Body:**
```json
{
  "name": "Updated Service Name",
  "description": "Updated description",
  "price": 75000,
  "duration": 75
}
```

**Success Response (200 OK):**
```json
{
  "id": 1,
  "name": "Updated Service Name",
  "description": "Updated description",
  "price": 75000,
  "EstimateDuration": 75,
  "is_active": true
}
```

---

#### Delete Service

```http
DELETE /services/:serviceId
```

**Description:** Delete a service (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `serviceId` (path) - Service ID

**Success Response (200 OK):**
```json
{
  "message": "Service deleted successfully"
}
```

---

### Slot Management

#### Get Business Slots (Public)

```http
GET /slots/public/:businessId
```

**Description:** Get available time slots for a business

**Authentication:** None (Public)

**URL Parameters:**
- `businessId` (path) - Business ID

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "business_profile_id": 1,
    "start_time": "09:00:00",
    "end_time": "10:00:00",
    "created_at": "2026-02-20T10:00:00.000Z"
  },
  {
    "id": 2,
    "business_profile_id": 1,
    "start_time": "10:00:00",
    "end_time": "11:00:00",
    "created_at": "2026-02-20T10:00:00.000Z"
  }
]
```

**Note:** Time format is HH:mm:ss (24-hour format)

---

#### Get Business Slots (Provider)

```http
GET /slots/:businessId
```

**Description:** Get all time slots for a business (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `businessId` (path) - Business ID

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "business_profile_id": 1,
    "start_time": "09:00:00",
    "end_time": "10:00:00",
    "created_at": "2026-02-20T10:00:00.000Z"
  }
]
```

---

#### Create Time Slot

```http
POST /slots/:businessId
```

**Description:** Add a new available time slot (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `businessId` (path) - Business ID

**Request Body:**
```json
{
  "startTime": "14:00:00",
  "endTime": "15:00:00"
}
```

**Validation Rules:**
- `startTime`: HH:mm:ss format
- `endTime`: HH:mm:ss format, must be after startTime

**Success Response (201 Created):**
```json
{
  "id": 3,
  "business_profile_id": 1,
  "start_time": "14:00:00",
  "end_time": "15:00:00",
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

---

#### Delete Time Slot

```http
DELETE /businesses/:businessId/slots/:slotId
```

**Description:** Delete a time slot (Owner Provider only)

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `businessId` (path) - Business ID
- `slotId` (path) - Slot ID

**Success Response (200 OK):**
```json
{
  "message": "Slot deleted successfully"
}
```

---

### Address Management

#### Get User Addresses

```http
GET /address
```

**Description:** Get all addresses for the current user

**Authentication:** Required 🔒

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "user_id": 1,
    "address_type": "home",
    "street": "123 Main Street",
    "city": "Mumbai",
    "state": "Maharashtra",
    "zip_code": "400001",
    "is_default": true
  },
  {
    "id": 2,
    "user_id": 1,
    "address_type": "work",
    "street": "456 Office Complex",
    "city": "Mumbai",
    "state": "Maharashtra",
    "zip_code": "400002",
    "is_default": false
  }
]
```

---

#### Add Address

```http
POST /address
```

**Description:** Add a new address for the current user

**Authentication:** Required 🔒

**Request Body:**
```json
{
  "street": "789 New Street",
  "city": "Delhi",
  "state": "Delhi",
  "zipCode": "110001",
  "address_type": "home"
}
```

**Validation Rules:**
- `street`: Minimum 3 characters
- `city`: Minimum 2 characters
- `state`: Minimum 2 characters
- `zipCode`: 6 digits
- `address_type`: Optional (home, work, billing, shipping, other)

**Success Response (201 Created):**
```json
{
  "id": 3,
  "user_id": 1,
  "address_type": "home",
  "street": "789 New Street",
  "city": "Delhi",
  "state": "Delhi",
  "zip_code": "110001",
  "is_default": false
}
```

---

#### Delete Address

```http
DELETE /address/:addressId
```

**Description:** Delete an address

**Authentication:** Required 🔒

**URL Parameters:**
- `addressId` (path) - Address ID

**Success Response (200 OK):**
```json
{
  "message": "Address deleted successfully"
}
```

---

### Booking Management

#### Get Booking by ID

```http
GET /booking/:id
```

**Description:** Get details of a specific booking

**Authentication:** Required 🔒
**Authorization:** Customer (owner) or Provider (business owner)

**URL Parameters:**
- `id` (path) - Booking ID

**Success Response (200 OK):**
```json
{
  "id": 1,
  "customer_id": 1,
  "business_profile_id": 1,
  "service_id": 1,
  "slot_id": 1,
  "address_id": 1,
  "booking_date": "2026-02-20T10:00:00.000Z",
  "status": "confirmed",
  "total_price": 50000,
  "customer": {
    "name": "John Doe",
    "phone": "9876543210"
  },
  "service": {
    "name": "Pipe Repair",
    "EstimateDuration": 60
  },
  "slot": {
    "start_time": "09:00:00",
    "end_time": "10:00:00"
  },
  "address": {
    "street": "123 Main Street",
    "city": "Mumbai",
    "state": "Maharashtra",
    "zip_code": "400001"
  }
}
```

---

#### Get Customer Bookings

```http
GET /bookings/customer
```

**Description:** Get all bookings for the current customer

**Authentication:** Required 🔒
**Authorization:** Customer only (roleId: 1)

**Query Parameters:**
- `status` (optional) - Filter by status (pending, confirmed, completed, cancelled)

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "business_name": "ABC Plumbing Services",
    "service_name": "Pipe Repair",
    "booking_date": "2026-02-20T10:00:00.000Z",
    "status": "confirmed",
    "total_price": 50000,
    "slot_time": "09:00:00 - 10:00:00"
  }
]
```

---

#### Get Provider Bookings

```http
GET /bookings/provider
```

**Description:** Get all bookings for the provider's business

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**Query Parameters:**
- `status` (optional) - Filter by status (pending, confirmed, completed, cancelled)

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "customer_name": "John Doe",
    "customer_phone": "9876543210",
    "service_name": "Pipe Repair",
    "booking_date": "2026-02-20T10:00:00.000Z",
    "status": "pending",
    "total_price": 50000,
    "address": {
      "street": "123 Main Street",
      "city": "Mumbai",
      "state": "Maharashtra",
      "zip_code": "400001"
    },
    "slot_time": "09:00:00 - 10:00:00"
  }
]
```

---

#### Create Booking

```http
POST /add-booking
```

**Description:** Create a new service booking

**Authentication:** Required 🔒
**Authorization:** Customer only (roleId: 1)

**Request Body:**
```json
{
  "serviceId": 1,
  "slotId": 1,
  "addressId": 1,
  "bookingDate": "2026-02-25"
}
```

**Validation Rules:**
- `serviceId`: Valid service ID
- `slotId`: Valid slot ID
- `addressId`: Valid address ID belonging to user
- `bookingDate`: Future date (ISO format)

**Success Response (201 Created):**
```json
{
  "id": 2,
  "customer_id": 1,
  "business_profile_id": 1,
  "service_id": 1,
  "slot_id": 1,
  "address_id": 1,
  "booking_date": "2026-02-25T00:00:00.000Z",
  "status": "pending",
  "total_price": 50000
}
```

**Error Responses:**
- `400 Bad Request` - Invalid date, slot unavailable, etc.
  ```json
  {
    "message": "Slot is not available for the selected date"
  }
  ```

---

#### Accept Booking

```http
PUT /accept-booking/:id
```

**Description:** Provider accepts a pending booking

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `id` (path) - Booking ID

**Success Response (200 OK):**
```json
{
  "id": 1,
  "status": "confirmed",
  "message": "Booking accepted successfully"
}
```

**Error Responses:**
- `400 Bad Request` - Booking not in pending status
  ```json
  {
    "message": "Cannot accept booking"
  }
  ```

---

#### Reject Booking

```http
PUT /reject-booking/:id
```

**Description:** Provider rejects a pending booking

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `id` (path) - Booking ID

**Success Response (200 OK):**
```json
{
  "id": 1,
  "status": "cancelled",
  "message": "Booking rejected successfully"
}
```

---

#### Complete Booking

```http
PUT /complete-booking/:id
```

**Description:** Provider marks a booking as completed

**Authentication:** Required 🔒
**Authorization:** Provider only (roleId: 2)

**URL Parameters:**
- `id` (path) - Booking ID

**Success Response (200 OK):**
```json
{
  "id": 1,
  "status": "completed",
  "message": "Booking marked as completed"
}
```

---

### Feedback Management

#### Get Business Feedback

```http
GET /feedback/business/:businessId
```

**Description:** Get all feedback for a business

**Authentication:** None (Public)

**URL Parameters:**
- `businessId` (path) - Business ID

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "booking_id": 1,
    "rating": 4.5,
    "comments": "Great service, very professional!",
    "created_at": "2026-02-20T10:00:00.000Z",
    "customer": {
      "name": "John Doe"
    }
  }
]
```

---

#### Get Service Feedback

```http
GET /feedback/service/:serviceId
```

**Description:** Get all feedback for a specific service

**Authentication:** None (Public)

**URL Parameters:**
- `serviceId` (path) - Service ID

**Success Response (200 OK):**
```json
[
  {
    "id": 1,
    "booking_id": 1,
    "rating": 5.0,
    "comments": "Excellent work!",
    "created_at": "2026-02-20T10:00:00.000Z",
    "customer": {
      "name": "John Doe"
    }
  }
]
```

---

#### Submit Feedback

```http
POST /add-feedback
```

**Description:** Submit feedback for a completed booking

**Authentication:** Required 🔒
**Authorization:** Customer only (roleId: 1)

**Request Body:**
```json
{
  "bookingId": 1,
  "rating": 4.5,
  "comments": "Great service, very professional!"
}
```

**Validation Rules:**
- `bookingId`: Valid booking ID belonging to user
- `rating`: Number between 1.0 and 5.0
- `comments`: Optional, max 300 characters

**Success Response (201 Created):**
```json
{
  "id": 1,
  "booking_id": 1,
  "rating": 4.5,
  "comments": "Great service, very professional!",
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

**Error Responses:**
- `400 Bad Request` - Invalid booking, feedback already submitted, etc.
  ```json
  {
    "message": "Feedback already submitted for this booking"
  }
  ```

---

## Error Handling

### Standard Error Response Format

All errors follow this structure:

```json
{
  "message": "Error description",
  "errors": ["Additional error details"]
}
```

### HTTP Status Codes

| Status Code | Meaning | Usage |
|-------------|---------|-------|
| 200 | OK | Successful request |
| 201 | Created | Resource created successfully |
| 400 | Bad Request | Validation errors, invalid data |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate resource (e.g., email exists) |
| 500 | Internal Server Error | Server error |

### Common Error Responses

#### Validation Error (400)
```json
{
  "message": "Validation failed",
  "errors": [
    "Email must be a valid email",
    "Phone must be 10 digits"
  ]
}
```

#### Unauthorized (401)
```json
{
  "message": "Authentication required"
}
```

#### Forbidden (403)
```json
{
  "message": "You do not have permission to perform this action"
}
```

#### Not Found (404)
```json
{
  "message": "Resource not found"
}
```

#### Server Error (500)
```json
{
  "message": "Internal server error",
  "error": "Detailed error message"
}
```

---

## Validation Rules

### Common Patterns

#### Phone Number
- **Regex:** `/^[6-9]\d{9}$/`
- **Format:** 10 digits starting with 6-9 (Indian mobile format)
- **Example:** `9876543210`

#### Email
- **Format:** Standard email format
- **Example:** `user@example.com`

#### ZIP Code
- **Format:** 6 digits
- **Example:** `400001`

#### Time Format
- **Format:** HH:mm:ss (24-hour)
- **Example:** `14:30:00`

#### Date Format
- **Format:** ISO 8601
- **Example:** `2026-02-20` or `2026-02-20T10:00:00.000Z`

### Field Validation Rules by Endpoint

#### Registration
- `name`: 3-50 characters, required
- `email`: Valid email, required, unique
- `phone`: 10 digits, required
- `password`: 6-30 characters, required
- `roleId`: Optional (1, 2, or 3)

#### Login
- `email`: Valid email, required
- `password`: Required

#### Address
- `street`: Min 3 characters, required
- `city`: Min 2 characters, required
- `state`: Min 2 characters, required
- `zipCode`: 6 digits, required
- `address_type`: Optional enum (home, work, billing, shipping, other)

#### Business
- `name`: 3-100 characters, required
- `description`: 10-500 characters, required
- `categoryId`: Valid ID, required
- `phone`: 10 digits, required
- `website`: Valid URL, optional

#### Service
- `name`: Min 3 characters, required
- `description`: Min 10 characters, required
- `price`: Positive number, max 100000, required
- `duration`: Positive number (minutes), max 1440, required

#### Slot
- `startTime`: HH:mm:ss format, required, must be before endTime
- `endTime`: HH:mm:ss format, required, must be after startTime

#### Booking
- `serviceId`: Valid service ID, required
- `slotId`: Valid slot ID, required
- `addressId`: Valid address ID (must belong to user), required
- `bookingDate`: Future date, required

#### Feedback
- `bookingId`: Valid booking ID, required
- `rating`: 1.0-5.0, required
- `comments`: Max 300 characters, optional

---

## Response Formats

### Success Response Patterns

#### Single Resource
```json
{
  "id": 1,
  "name": "Resource Name",
  "created_at": "2026-02-20T10:00:00.000Z"
}
```

#### Array of Resources
```json
[
  {
    "id": 1,
    "name": "Resource 1"
  },
  {
    "id": 2,
    "name": "Resource 2"
  }
]
```

#### With Message
```json
{
  "message": "Operation successful",
  "data": {
    "id": 1,
    "name": "Resource Name"
  }
}
```

### Nested Resources

Some responses include nested related resources:

```json
{
  "id": 1,
  "name": "Business Name",
  "category": {
    "id": 1,
    "name": "Plumbing"
  },
  "services": [
    {
      "id": 1,
      "name": "Service Name"
    }
  ]
}
```

### Price Handling

**Important:** All price fields are stored in paisa/cents (smallest currency unit).

**Example:**
- Stored: `50000` (in API response)
- Display: `500.00` (divide by 100)

```javascript
// Convert to display format
const displayPrice = apiPrice / 100; // 500.00

// Convert to API format
const apiPrice = displayPrice * 100; // 50000
```

---

## Integration Notes for Frontend

### 1. Cookie Management

The API uses httpOnly cookies for authentication. The frontend doesn't need to manually handle tokens:

```javascript
// Login - cookie is set automatically
await fetch('http://localhost:8000/login', {
  method: 'POST',
  credentials: 'include', // Important for cookies
  body: JSON.stringify({ email, password })
});

// Authenticated requests - cookie sent automatically
await fetch('http://localhost:8000/user/profile', {
  credentials: 'include' // Important for cookies
});
```

### 2. CORS Configuration

Ensure your frontend origin is configured:

```javascript
// .env file on backend
FRONTEND_URL=http://localhost:3000
```

Frontend requests must include:
```javascript
credentials: 'include'
```

### 3. Date/Time Handling

- **Booking Date:** Send as `YYYY-MM-DD` or ISO format
- **Time Slots:** Expects `HH:mm:ss` format
- **Display Dates:** Consider using libraries like `date-fns` or `moment`

```javascript
// Format time for display
const formatTime = (time) => {
  const [hours, minutes] = time.split(':');
  return `${hours}:${minutes}`; // "09:00"
};
```

### 4. Error Handling

Implement consistent error handling:

```javascript
const handleResponse = async (response) => {
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Request failed');
  }
  return response.json();
};
```

### 5. Role-Based UI

Show/hide features based on user role:

```javascript
const role = user.role_id;
// 1 = Customer
// 2 = Provider
// 3 = Admin

if (role === 2) {
  // Show provider dashboard
}
```

### 6. Image Uploads

Currently not implemented. Plan for future:
- Business logos
- Service images
- User avatars

### 7. Pagination

Not currently implemented. All endpoints return complete arrays.

### 8. Real-time Updates

Not currently implemented. Consider:
- WebSocket for booking status updates
- Polling for new bookings (providers)

### 9. Testing

Use these test credentials (after seeding):

```javascript
// Customer
{
  email: "customer@test.com",
  password: "password123",
  role_id: 1
}

// Provider
{
  email: "provider@test.com",
  password: "password123",
  role_id: 2
}

// Admin
{
  email: "admin@test.com",
  password: "password123",
  role_id: 3
}
```

---

## Appendix

### Database Migration Files

Located in `/migrations` directory. Run with:
```bash
npm run migrate
```

### Database Seeding

Seed the database with sample data:
```bash
npm run seed
```

### Environment Variables

Create a `.env` file:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=home_service_db
DB_USER=postgres
DB_PASSWORD=your_password

# Server
PORT=8000

# Frontend
FRONTEND_URL=http://localhost:3000

# JWT
JWT_SECRET=your_secret_key_here
```

### Support

For issues or questions, contact the backend development team.

---

**Document Version:** 1.0.1
**Last Updated:** 2026-02-20
