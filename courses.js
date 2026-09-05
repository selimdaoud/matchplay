const fs = require('fs');
const path = require('path');

const COURSES_DIR = path.join(__dirname, 'data', 'courses');

function courseIdFromFilename(filename) {
  return path.basename(filename, path.extname(filename))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function courseNameFromFilename(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^| )(\S)/g, (_match, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('fr-FR')}`);
}

function discoverCourses() {
  const courses = { none: { id: 'none', name: 'None', holes: [] } };
  const files = fs.readdirSync(COURSES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.csv')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  files.forEach((file) => {
    const id = courseIdFromFilename(file);
    if (!id || id === 'none' || courses[id]) {
      throw new Error(`Nom de fichier de parcours invalide ou dupliqué : ${file}`);
    }
    courses[id] = { id, name: courseNameFromFilename(file), file };
  });

  return courses;
}

const COURSES = discoverCourses();

function parseCourseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  return lines.slice(1).map((line) => {
    const [hole, par, averageScore, difference] = line.split(',').map((part) => part.trim());
    return {
      hole: Number(hole),
      par: Number(par),
      averageScore: Number(averageScore),
      difference: Number(difference),
    };
  }).filter((row) => Number.isInteger(row.hole) && Number.isFinite(row.par) && Number.isFinite(row.averageScore));
}

function normalizeCourseId(courseId) {
  return COURSES[courseId] ? courseId : 'none';
}

function getCourse(courseId) {
  const id = normalizeCourseId(courseId);
  const course = COURSES[id];
  if (!course.file) return course;

  const filePath = path.join(COURSES_DIR, course.file);
  const holes = parseCourseCsv(fs.readFileSync(filePath, 'utf8'));
  return { id: course.id, name: course.name, holes };
}

function getCourseOptions() {
  return Object.values(COURSES).map(({ id, name }) => ({ id, name }));
}

module.exports = {
  getCourse,
  getCourseOptions,
  normalizeCourseId,
};
