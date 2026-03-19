console.log('argv:', process.argv);
console.log('Positional arguments:');
for (let i = 2; i < process.argv.length; i++) {
    console.log(`  [${i-2}]: "${process.argv[i]}"`);
}
