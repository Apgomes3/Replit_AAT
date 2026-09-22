const fs=require('fs'); const {execFileSync}=require('child_process');
const pdf='.agents/outputs/bio-degas-plenum-visual-reference.pdf';
console.log(require('fs').statSync(pdf).size);
