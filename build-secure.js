// [build-secure.js]
const fs = require('fs-extra');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const srcDir = __dirname; 
const destDir = path.join(__dirname, 'release-src');

// 1. 임시 폴더(release-src)를 만들고 파일 복사 및 package.json 최적화
async function prepare() {
  await fs.remove(destDir);
  await fs.mkdir(destDir);

  // 💡 package.json은 아래에서 별도로 처리하므로 여기서 뺍니다.
  const filesToCopy = [
    'main.js', 'preload.js', 'widget.js', 'calendar.js',
    'index.html', 'calendar.html',
    'credentials.json', 'logo.svg', 'icon.ico' , 'assets/googleLogo.svg'
  ];

  for (const file of filesToCopy) {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    if (fs.existsSync(srcPath)) {
      await fs.copy(srcPath, destPath);
    }
  }

  // 🔥 핵심: package.json에서 에러를 유발하는 항목을 지우고 깨끗하게 복사합니다.
  const pkgPath = path.join(srcDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = await fs.readJson(pkgPath);
    delete pkg.build;           // 에러 원인(build 블록) 제거!
    delete pkg.scripts;         // 배포본에 필요 없는 스크립트 제거
    delete pkg.devDependencies; // 배포본에 필요 없는 개발용 모듈 목록 제거
    await fs.writeJson(path.join(destDir, 'package.json'), pkg, { spaces: 2 });
  }

  console.log('✅ 1/2: 안전한 공간(release-src)으로 파일 복사 및 package.json 최적화 완료');
}

// 2. 복사된 JS 파일들을 난독화(암호화) 합니다.
async function obfuscate() {
  const jsFiles = ['main.js', 'preload.js', 'widget.js', 'calendar.js'];

  for (const file of jsFiles) {
    const filePath = path.join(destDir, file);
    if (fs.existsSync(filePath)) {
      const code = await fs.readFile(filePath, 'utf8');
      
      // 난독화 옵션
      const obfuscatedCode = JavaScriptObfuscator.obfuscate(code, {
        compact: true,
        controlFlowFlattening: true,    
        deadCodeInjection: true,        
        stringArray: true,
        stringArrayEncoding: ['base64'],
        disableConsoleOutput: true,     
      }).getObfuscatedCode();

      await fs.writeFile(filePath, obfuscatedCode);
      console.log(`🔐 2/2: 난독화 완료 -> ${file}`);
    }
  }
}

async function run() {
  try {
    await prepare();
    await obfuscate();
    console.log('🚀 모든 준비 완료! 이제 패키징을 시작합니다.');
  } catch (err) {
    console.error('❌ 에러 발생:', err);
  }
}

run();