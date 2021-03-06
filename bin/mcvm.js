#!/usr/bin/env node
var fs = require('fs')
var path = require('path')
var escodegen = require('escodegen')
var nopt = require('nopt')
var noptUsage = require('nopt-usage')
var rootPath = path.join(__dirname, '..')
var McVMJS = require(path.join(rootPath, 'lib', 'main'))
var _McLib = require(path.join(rootPath, 'lib', 'mclib'))
var browserify = require('browserify')
var str = require('string-to-stream')

var knownOpts = {
  'bundle': Boolean,
  'help': Boolean,
  'no-js-codegen': Boolean,
  'no-preamble': Boolean,
  'pretty-print': Boolean,
  'read-matlab-json': Boolean,
  'run': Boolean,
  'trace-matlab-ast': Boolean,
  'trace-js-ast': Boolean,
  'trace-js-codegen': Boolean,
  'verbose': Boolean
}

var shortHands = {
  'h': '--help',
  'v': '--verbose'
}

var description = {
  'help': ' Display this help',
  'no-js-codegen': ' Skip the JS code generation phase',
  'no-preamble': ' Skip the preamble section with the library stuff',
  'pretty-print': ' The output and traces will be pretty printed',
  'read-matlab-json': ' FILE will be interpreted as a MATLAB JSON AST',
  'run': ' Run the generated code',
  'trace-matlab-ast': ' Log the JSON MATLAB AST that was produced by the Natlab parser',
  'trace-js-ast': ' Log the JSON JS AST that was produced from the MATLAB AST',
  'trace-js-codegen': ' Log the JS code that was generated from the JS AST',
  'verbose': ' Output intermediary information during compilation'
}

var parsed = nopt(knownOpts, shortHands)
if (parsed.help || parsed.argv.remain.length < 1) {
  var usage = noptUsage(knownOpts, shortHands, description)
  console.log(path.basename(__filename) + ' OPTIONS FILE(S)')
  console.log('Options:')
  console.log(usage)

  if (parsed.verbose) {
    console.log('Parsed options:')
    console.log(parsed)
  }
  process.exit(1)
}

var options = {
  bundle: !!parsed['bundle'],
  prettyPrint: !!parsed['pretty-print'],
  outputPreamble: parsed['preamble'] === undefined || !!parsed['preamble'],
  readMatlabJSON: !!parsed['read-matlab-json'],
  jsCodegen: parsed['js-codegen'] === undefined || !!parsed['js-codegen'],
  traceJSAST: !!parsed['trace-js-ast'],
  traceMatlabAST: !!parsed['trace-matlab-ast'],
  traceJSCodeGen: !!parsed['trace-js-codegen'],
  useInlineCaches: false,
  paths: parsed.argv.remain,
  run: !!parsed['run'],
  verbose: !!parsed['verbose']
}

function verboseLog (msg) {
  if (options.verbose) {
    console.log('verbose: ' + msg)
  }
}

function stringifyJSONThen (cb) {
  return function (jsonObj) {
    cb(options.prettyPrint ? JSON.stringify(jsonObj, null, '  ') : JSON.stringify(jsonObj))
  }
}

function runJSThen (cb) {
  return function (jscode) {
    verboseLog('running generated code')
    cb(eval(jscode))
  }
}

function compileToJSASTThen (cb) {
  return function (ast) {
    verboseLog('compiling MATLAB ast')
    cb(McVMJS.compileMatlabAST(ast, options))
  }
}

function codegenToJSStringThen (cb) {
  var numericSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'numeric.js')).toString()
  var matlabSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'matlab.js')).toString()
  var mclibSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mclib.js')).toString()
  return function (ast) {
    verboseLog('generating JS code from JS ast (preamble==' + options.outputPreamble + ')')
    cb(((!options.outputPreamble
      ? [escodegen.generate(ast)]
      : [
        numericSrc,
        matlabSrc,
        mclibSrc,
        escodegen.generate(ast)
      ]).join('\n')))
  }
}

function browserifyJSThen (cb) {
  return function (code) {
    browserify(str(code), {
      basedir: path.join(__dirname, '..'),
      standalone: 'bundle'
    }).bundle((err, s) => {
      if (err) {
        console.log(err)
        process.exit(1)
      }
      cb(String(s))
    })
  }
}

function readMatlabAstFromJSONFileThen (cb) {
  return function (paths) {
    verboseLog('reading MATLAB JSON file')
    if (paths.length > 1) {
      console.log('Unsupported multiple JSON files')
      process.exit(1)
    }
    cb(JSON.parse(fs.readFileSync(path)))
  }
}

function readMatlabAstFromFileThen (cb) {
  return function (paths) {
    verboseLog('parsing MATLAB input')
    McVMJS.parseMatlabFiles(paths, cb)
  }
}

function logThen (cb) {
  return function (s) {
    console.log(s)
    cb(s)
  }
}

function doNothing () {}

if (options.paths.length < 1) {
  console.log('Error: No file path was provided')
  process.exit(1)
}

function dup (cb1) {
  return function (cb2) {
    return function (value) {
      cb1(value)
      cb2(value)
    }
  }
}

// Define the sequence of callbacks that will be called
var steps = []
steps.push(options.readMatlabJSON ? readMatlabAstFromJSONFileThen : readMatlabAstFromFileThen)

if (options.traceMatlabAST === true) {
  steps.push(dup(stringifyJSONThen(console.log)))
}

steps.push(compileToJSASTThen)

if (options.traceJSAST === true) {
  steps.push(dup(stringifyJSONThen(console.log)))
}

if (options.jsCodegen === true) {
  steps.push(codegenToJSStringThen)
  if (!options.run && !options.bundle) {
    steps.push(logThen)
  }
}

if (options.bundle === true) {
  steps.push(browserifyJSThen)

  if (!options.run) {
    steps.push(logThen)
  }
}

if (options.run) {
  steps.push(runJSThen)
}

// Assemble the callbacks together
var next = doNothing
for (var i = steps.length - 1; i >= 0; --i) {
  next = steps[i](next)
}

// Call the first callback 
next(options.paths)
