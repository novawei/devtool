#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const yml = require('yml')
const copy = require('recursive-copy')
const convert = require('xml-js')
const child_process = require('child_process')
const find = require('find-process')
const del = require('del')

function findProcess(name) {
  return new Promise((resolve, reject) => {
    find('name', name).then(list => {
      if (!list.length) {
        resolve()
      } else {
        resolve(list[0])
      }
    })
  })
}

async function sleep(time) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve()
    }, time)
  })
}

async function copyDir(src, dest) {
  return new Promise((resolve, reject) => {
    copy(src, dest, (error, results) => {
      if (error) {
        resolve(false)
      } else {
        resolve(true)
      }
    })
  })
}

async function execTomcatScript(tomcatDir, scriptName) {
  let bin = undefined
  let p = undefined
  if (isWinPlatform()) {
    bin = path.resolve(tomcatDir, 'bin', `${scriptName}.bat`)
    p = child_process.spawn('cmd.exe', ['/c', bin], {
      detached: true,
      stdio: 'ignore'
    })
  } else {
    bin = path.resolve(tomcatDir, 'bin', `${scriptName}.sh`)
    p = child_process.spawn('bash', [bin], {
      detached: true,
      stdio: 'ignore'
    })
  }
  p.unref()
}

function isWinPlatform() {
  return process.platform.indexOf('win') === 0
}

function getWorkDir(projectDir, tomcatName = undefined) {
  if (tomcatName) {
    return path.resolve(projectDir, '.devtool', `tomcat-${tomcatName}`)
  }
  return path.resolve(projectDir, '.devtool')
}

function addExecPermission(tomcatDir) {
  const binDir = path.resolve(tomcatDir, 'bin')
  const files = fs.readdirSync(binDir)
  for (let filename of files) {
    if (path.extname(filename) === '.bat' || path.extname(filename) === '.sh') {
      const binPath = path.resolve(binDir, filename)
      fs.chmodSync(binPath, '777')
    }
  }
}

function configServerXml(cnf, tomcatDir) {
  const xmlPath = path.resolve(tomcatDir, 'conf', 'server.xml')
  let xmlContent = fs.readFileSync(xmlPath)
  const json = convert.xml2js(xmlContent)
  let serverElem = undefined
  for (let item of json.elements) {
    if (item.type === 'element' && item.name === 'Server') {
      serverElem = item
      break
    }
  }
  if (serverElem) {
    if (cnf.serverPort) {
      serverElem.attributes.port = cnf.serverPort
    }
    let serviceElem = undefined
    for (let item of serverElem.elements) {
      if (item.type === 'element' && item.name === 'Service') {
        serviceElem = item
        break
      }
    }
    if (serviceElem) {
      for (let item of serviceElem.elements) {
        if (item.type === 'element' && item.name === 'Connector') {
          if (item.attributes.protocol.indexOf('HTTP') !== -1) {
            if (cnf.httpPort) {
              item.attributes.port = cnf.httpPort
            }
          } else if (cnf.ajpPort) {
              item.attributes.port = cnf.ajpPort
          }
          if (cnf.redirectPort) {
            item.attributes.redirectPort = cnf.redirectPort
          }
        }
      }
    }
  }
  fs.renameSync(xmlPath, `${xmlPath}.bak`)
  xmlContent = convert.js2xml(json)
  fs.writeFileSync(xmlPath, xmlContent)
}

async function configVmOptions(cnf, tomcatDir) {
  if (!cnf.vmOptions || cnf.vmOptions == '') {
    return
  }

  const catalinaShPath = path.resolve(tomcatDir, 'bin', 'catalina.sh')
  let content = fs.readFileSync(catalinaShPath)
  content = `export JAVA_OPTS="${cnf.vmOptions}"\n${content}`
  fs.writeFileSync(catalinaShPath, content)

  const catalinaBatPath = path.resolve(tomcatDir, 'bin', 'catalina.bat')
  content = fs.readFileSync(catalinaBatPath)
  content = `set JAVA_OPTS=${cnf.vmOptions}\n${content}`
  fs.writeFileSync(catalinaBatPath, content)
}

async function initTomcats(projectDir) {
  const workDir = getWorkDir(projectDir)
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir)
  }

  const ymlPath = path.resolve(projectDir, 'devcnf.yml')
  const devcnf = yml.load(ymlPath)
  const tomcatPath = devcnf.tomcatPath
  for (let cnf of devcnf.tomcatList) {
    console.log(`init tomcat-${cnf.name}`)
    const destPath = getWorkDir(projectDir, cnf.name)
    // copy tomcat to target path
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath)
      console.log(`  copy files from ${tomcatPath}`)
      await copyDir(tomcatPath, destPath)
    }
    // modify port and override server.xml file
    console.log(`  config server xml`)
    configServerXml(cnf, destPath)
    console.log(`  config vm options`)
    configVmOptions(cnf, destPath)
    // add exec permission
    console.log(`  add exec permission`)
    addExecPermission(destPath)
  }
}

async function startTomcat(projectDir, tomcatName) {
  console.log(`start tomcat-${tomcatName}`)
  const tomcatDir = getWorkDir(projectDir, tomcatName)
  if (!fs.existsSync(tomcatDir)) {
    console.error(`${tomcatDir} NOT EXIST!!!`)
  }
  execTomcatScript(tomcatDir, 'startup')
  // check process status
  let tryCount = 5
  while(tryCount-- > 0) {
    await sleep(2000)
    const p = await findProcess(`-Dcatalina.base=${tomcatDir}`)
    if (p) {
      console.log(`tomcat-${tomcatName} started!!! pid: ${p.pid}`)
      break
    }
  }
}

async function stopTomcat(projectDir, tomcatName, forceStop = true) {
  console.log(`stop tomcat-${tomcatName}`)
  const tomcatDir = getWorkDir(projectDir, tomcatName)
  if (!fs.existsSync(tomcatDir)) {
    console.error(`${tomcatDir} NOT EXIST!!!`)
  }
  execTomcatScript(tomcatDir, 'shutdown')
  // check process status
  while(forceStop) {
    await sleep(1000)
    const p = await findProcess(`-Dcatalina.base=${tomcatDir}`)
    if (!p) {
      break
    } else {
      process.kill(p.pid, 9)
    }
  }
  console.log(`tomcat-${tomcatName} stopped!!!`)
}

async function deployWebapps(projectDir, tomcatName) {
  console.log(`start deploy to tomcat-${tomcatName}`)
  const ymlPath = path.resolve(projectDir, 'devcnf.yml')
  const devcnf = yml.load(ymlPath)
  let tomcatCnf = undefined
  for (let cnf of devcnf.tomcatList) {
    if (cnf.name === tomcatName) {
      tomcatCnf = cnf
      break
    }
  }
  if (!tomcatCnf || !tomcatCnf.webapps || tomcatCnf.webapps.length === 0) {
    console.error('no webapps need deploy!!!')
    return
  }

  // clean old webapps
  const tomcatDir = getWorkDir(projectDir, tomcatName)
  const webappsDir = path.resolve(tomcatDir, 'webapps')
  const webapps = fs.readdirSync(webappsDir)
  for (let app of webapps) {
    if (app === 'docs' || app === 'examples' || app === 'host-manager'
      || app === 'manager' || app === 'ROOT') {
        continue
    }
    const destPath = path.resolve(webappsDir, app)
    await del(`${destPath}/**`)
  }

  // deploy new webapps
  for (let app of tomcatCnf.webapps) {
    const contextPath = Object.keys(app).shift()
    const appPath = app[contextPath]
    console.log(`  deploy ${contextPath}:${appPath}`)
    const destPath = path.resolve(webappsDir, contextPath)
    const appName = path.basename(appPath)
    const targetPath = path.resolve(projectDir, appPath, 'target', appName)
    if (!fs.existsSync(targetPath)) {
      console.log(`    target ${appName} NOT EXIST!!!`)
      continue
    } else {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath)
      }
      await copyDir(targetPath, destPath)
    }
  }
}

async function main() {
  const projectDir = process.cwd()
  const ymlPath = path.resolve(projectDir, 'devcnf.yml')
  if (!fs.existsSync(ymlPath)) {
    console.error('devcnf.yml NOT FOUND!!!')
    return
  }

  // parse cmd argv
  const argv = process.argv.slice(2)
  const cmd = argv.shift()
  const tomcatName = argv.shift()
  
  switch (cmd) {
    case 'init':
      initTomcats(projectDir)
      break
    case 'start':
      startTomcat(projectDir, tomcatName)
      break
    case 'stop':
      stopTomcat(projectDir, tomcatName)
      break
    case 'restart':
      await stopTomcat(projectDir, tomcatName)
      await sleep(1000)
      startTomcat(projectDir, tomcatName)
      break
    case 'deploy':
      deployWebapps(projectDir, tomcatName)
      break
    default:
      console.log(`${cmd} not defined!`)
  }
}

main()