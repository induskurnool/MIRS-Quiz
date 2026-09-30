const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const XLSX = require('xlsx');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
  questions: path.join(DATA_DIR, 'questions.json'),
  students: path.join(DATA_DIR, 'students.json'),
  results: path.join(DATA_DIR, 'results.json')
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  Object.entries(FILES).forEach(([key, filePath]) => {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2));
    }
  });
}

function readJson(filePath, fallback = []) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]/g, '');
}

function pick(row, ...names) {
  const keys = Object.keys(row || {});
  for (const want of names) {
    const target = normalizeHeader(want);
    const key = keys.find((entry) => normalizeHeader(entry) === target);
    if (key !== undefined) {
      const value = row[key];
      if (String(value).trim() !== '') {
        return value;
      }
    }
  }
  return '';
}

function parseWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows;
}

function normalizeQuestions(rows) {
  return rows
    .map((row) => {
      if (typeof row.q === 'string' && Array.isArray(row.opts)) {
        const options = row.opts.slice(0, 4).map((option) => String(option ?? '').trim());
        while (options.length < 4) {
          options.push('');
        }
        const correctIdx = Number(row.correctIdx);
        return {
          q: row.q.trim(),
          opts: options,
          correctIdx: Number.isInteger(correctIdx) && correctIdx >= 0 && correctIdx < 4 ? correctIdx : 0
        };
      }

      const options = [
        pick(row, 'OptionA', 'Option A', 'A', 'Opt A', 'Choice A'),
        pick(row, 'OptionB', 'Option B', 'B', 'Opt B', 'Choice B'),
        pick(row, 'OptionC', 'Option C', 'C', 'Opt C', 'Choice C'),
        pick(row, 'OptionD', 'Option D', 'D', 'Opt D', 'Choice D')
      ];
      const question = pick(row, 'Question', 'Q', 'QuestionText');
      let answer = String(pick(row, 'Answer', 'Correct', 'CorrectAnswer', 'Correct Answer')).trim();
      let correctIndex = { A: 0, B: 1, C: 2, D: 3 }[answer.toUpperCase()];
      if (correctIndex === undefined) {
        correctIndex = options.findIndex((option) => String(option).trim().toLowerCase() === answer.toLowerCase());
      }
      return {
        q: question,
        opts: options,
        correctIdx: correctIndex >= 0 ? correctIndex : 0
      };
    })
    .filter((entry) => entry.q && String(entry.q).trim() !== '');
}

function normalizeStudents(rows) {
  return rows
    .map((row) => ({
      name: pick(row, 'Name', 'Student Name', 'Full Name', 'Participant'),
      id: String(pick(row, 'ID', 'Id', 'Roll No', 'RollNo', 'Roll Number', 'Student ID', 'Admission No', 'Email')).trim()
    }))
    .filter((entry) => entry.name && String(entry.name).trim() !== '');
}

function loadQuestions() {
  return readJson(FILES.questions, []);
}

function loadStudents() {
  return readJson(FILES.students, []);
}

function loadResults() {
  return readJson(FILES.results, []);
}

function studentKey(student) {
  return `${String(student?.name || '').trim().toLowerCase()}|${String(student?.id || '').trim().toLowerCase()}`;
}

function studentHasAttempt(results, student) {
  if (!student || !student.name || !student.id) {
    return false;
  }
  const target = studentKey(student);
  return results.some((entry) => studentKey(entry) === target);
}

function broadcastState() {
  io.emit('state', {
    questions: loadQuestions(),
    students: loadStudents(),
    results: loadResults()
  });
}

ensureDataFiles();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Quiz backend is running', time: new Date().toISOString() });
});

app.get('/api/questions', (req, res) => {
  res.json(loadQuestions());
});

app.get('/api/students', (req, res) => {
  res.json(loadStudents());
});

app.get('/api/results', (req, res) => {
  res.json(loadResults());
});

app.post('/api/questions', upload.single('file'), (req, res) => {
  try {
    let rows = [];
    if (req.file) {
      rows = parseWorkbookRows(req.file.buffer);
    } else if (req.body && Array.isArray(req.body.questions)) {
      rows = req.body.questions;
    } else if (req.body && req.body.data && Array.isArray(req.body.data)) {
      rows = req.body.data;
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      rows = [req.body];
    }

    const normalized = normalizeQuestions(rows);
    saveJson(FILES.questions, normalized);
    broadcastState();
    res.json({ ok: true, count: normalized.length });
  } catch (error) {
    console.error('Failed to save questions:', error);
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/students', upload.single('file'), (req, res) => {
  try {
    let rows = [];
    if (req.file) {
      rows = parseWorkbookRows(req.file.buffer);
    } else if (req.body && Array.isArray(req.body.students)) {
      rows = req.body.students;
    } else if (req.body && req.body.data && Array.isArray(req.body.data)) {
      rows = req.body.data;
    } else if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      rows = [req.body];
    }

    const normalized = normalizeStudents(rows);
    saveJson(FILES.students, normalized);
    broadcastState();
    res.json({ ok: true, count: normalized.length });
  } catch (error) {
    console.error('Failed to save students:', error);
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/results', (req, res) => {
  try {
    const incoming = Array.isArray(req.body) ? req.body : Array.isArray(req.body.results) ? req.body.results : [req.body];
    const current = loadResults();
    const seen = new Set(current.map(studentKey));
    const uniqueIncoming = [];

    for (const result of incoming.filter(Boolean)) {
      if (!result || !result.name || !result.id) {
        continue;
      }
      const key = studentKey(result);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueIncoming.push(result);
    }

    if (!uniqueIncoming.length && incoming.some((result) => result && result.name && result.id)) {
      return res.status(409).json({ ok: false, error: 'This student has already attempted the quiz. Please wait for the admin to reset it.' });
    }

    const next = [...current, ...uniqueIncoming];
    saveJson(FILES.results, next);
    io.emit('results:updated', { results: next });
    broadcastState();
    res.json({ ok: true, count: next.length });
  } catch (error) {
    console.error('Failed to save results:', error);
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.delete('/api/reset', (req, res) => {
  for (const filePath of Object.values(FILES)) {
    saveJson(filePath, []);
  }
  broadcastState();
  res.json({ ok: true, message: 'Quiz data reset' });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('state', {
    questions: loadQuestions(),
    students: loadStudents(),
    results: loadResults()
  });

  socket.on('quiz:result', (payload) => {
    const current = loadResults();
    if (!payload || !payload.name || !payload.id || studentHasAttempt(current, payload)) {
      socket.emit('quiz:error', { message: 'This student has already attempted the quiz. Please wait for the admin to reset it.' });
      return;
    }
    const next = [...current, payload].filter(Boolean);
    saveJson(FILES.results, next);
    io.emit('results:updated', { results: next });
    broadcastState();
  });

  socket.on('admin:reset', () => {
    for (const filePath of Object.values(FILES)) {
      saveJson(filePath, []);
    }
    broadcastState();
  });
});

server.listen(PORT, () => {
  console.log(`Quiz backend listening on http://localhost:${PORT}`);
});

module.exports = app;
