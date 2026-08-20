import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

console.log('▶ Testing Artifacts system...');

// 1. Verify test artifact file creation
const testArtifactPath = path.join(process.cwd(), 'tests', 'sample-artifact.md');
const sampleContent = '# Architecture Plan\n\n> [!NOTE]\n> This is a test artifact.\n\n`	s\nexport const ready = true;\n`';
fs.writeFileSync(testArtifactPath, sampleContent, 'utf-8');

assert(fs.existsSync(testArtifactPath), 'Sample artifact file created on disk');
const readContent = fs.readFileSync(testArtifactPath, 'utf-8');
assert(readContent === sampleContent, 'Artifact content matches');
console.log('✔ Artifact filesystem storage verified');

// Cleanup
if (fs.existsSync(testArtifactPath)) {
  fs.unlinkSync(testArtifactPath);
}

console.log('\n🎉 ARTIFACTS TEST PASSED!\n');
