const exec = require('child_process').exec;
const path = require('path'); 
const mountPath = path.join(__dirname, '../../mount/generated/');
const config = require('./config');

module.exports = {
  startComposeProfile,
  stopComposeProfile,
  deployContract,
  executeTest
}

function startComposeProfile(profile){
  const compose = config.compose
  executeCommandSync(`${compose} --profile ${profile} pull`)
  executeCommandSync(`${compose} --profile ${profile} up -d`)
}

function stopComposeProfile(profile){
  const compose = config.compose
  executeCommandSync(`${compose} --profile ${profile} down`)
}

function deployContract(){
  // docker pull xinfinorg/csc:feature-v0.3.0
  // docker run -v ${PWD}/:/app/cicd/mnt/ --network generated_docker_net xinfinorg/csc:feature-v0.3.0 full
  // need to figure what to use instead of ${PWD}, probably need host full path

  executeCommandSync(`docker pull xinfinorg/csc:feature-v0.3.0`)
  executeCommandSync(`docker run -v /Users/wp/Git/Subnet-Deployment/container-manager/mount/generated/:/app/cicd/mount/ --network generated_docker_net xinfinorg/csc:feature-v0.3.0 full`)
}

// function executeCommandSync(command) {
//   const pathCommand = 'cd '+mountPath+';'+'export PWD=/Users/wp/Git/Subnet-Deployment/container-manager/mount/generated;'+command
//   const output = execSync(pathCommand).toString();
//   console.log(`Command output: ${output}`);
//   return output;
// // // Example usage:
// // try {
// //     const output = executeCommandSync('ls -l');
// //     console.log('Command output:', output);
// // } catch (error) {
// //     console.error('Error:', error);
// // }
// }



//test command
// executeTest('echo a; sleep 1; echo b; sleep 1; echo c; sleep 1; skdjf;asjdkfasjdflsa; sleep 1; exit 1; sleep 1; echo f')
async function executeTest(command, outputHandler, doneHandler){
  command = 'echo $RANDOM; sleep 1; echo $RANDOM; sleep 1; echo a; sleep 1; echo b; sleep 1; echo c; sleep 1; echo d; sleep 1; echo e; sleep 1; echo f'
  const pathCommand = 'cd '+mountPath+';'+'export PWD=/Users/wp/Git/Subnet-Deployment/container-manager/mount/generated;'+command
  execProcess = exec(pathCommand)

  execProcess.stdout.on('data', (data) => {
    process.stdout.write(data.toString());
    outputHandler(data.toString());
  });

  execProcess.stderr.on('data', (data) => {
    console.error(data.toString());
    outputHandler(data.toString());
  });

  execProcess.on('error', (err) => {
    console.error('Failed to start exec process:', err.message);
    doneHandler()
  });

  execProcess.on('close', (code) => {
    console.log(`Exec process exited with code ${code}`);
    doneHandler()
  });


}


