# Montessori Quiz Backend

This project includes a lightweight Node.js backend for a classroom quiz app. It serves the static front end, persists quiz data to the `data/` folder, and broadcasts updates in real time through Socket.IO.

## Start the backend

```bash
npm install
npm start
```

Then open http://localhost:3000 in your browser.

## API endpoints

- `GET /api/health` — confirm the server is running
- `GET /api/questions` — list saved questions
- `POST /api/questions` — save questions as JSON or upload an XLSX/CSV file
- `GET /api/students` — list saved students
- `POST /api/students` — save student records as JSON or upload an XLSX/CSV file
- `GET /api/results` — list saved quiz attempts
- `POST /api/results` — add a result record
- `DELETE /api/reset` — clear all stored data

## Real-time features

- Live synchronization between browsers connected to the same server
- Instant result updates when a student finishes a quiz
- Auto-refresh of the results table without reloading the page
- Each student can attempt the quiz only once until the admin resets the quiz data

## Notes

The app still works in browser-only mode from `localStorage`, but the backend keeps uploaded data persistent and shared across sessions.
