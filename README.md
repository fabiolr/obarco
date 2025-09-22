# O Barco - Boat Task Management System

A simple, mobile-first task management system designed for boat crews and managers.

## Features

- ✅ **User Authentication** - Simple username/password system
- 📋 **Task Management** - Create, edit, and track items/tasks
- 📎 **File Attachments** - Upload photos, documents, invoices (up to 50MB)
- 📱 **Mobile-First Design** - Optimized for iPhone/mobile use
- 💬 **Comments System** - Add updates and notes to tasks
- 📊 **Status Tracking** - Multiple status levels including 3rd party workflow
- 📅 **Due Dates** - Set expected completion dates with overdue highlighting
- 📤 **CSV Export** - Download all tasks as CSV file
- 🔄 **Real-time Updates** - Items automatically update status when viewed

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite
- **Frontend:** EJS templates, vanilla JavaScript
- **File Storage:** Local file system with multer
- **Authentication:** Cookies with bcrypt password hashing

## Installation

### Prerequisites
- Node.js (v14 or higher)
- npm

### Setup

1. **Clone the repository:**
```bash
git clone https://github.com/fabiolr/obarco-todos.git
cd obarco-todos
