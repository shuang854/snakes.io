var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var SOCKET_LIST = {};
var PLAYER_LIST = {};
var ROOM_LIST = [];

app.set('port', (process.env.PORT || 2000));

app.get('/',function(req, res) {
    res.sendFile(__dirname + '/lobby.html');
});

app.get('/*', function(req, res) {
    var url = req.path.substring(1);
    for (var i = 0; i < ROOM_LIST.length; i++) {
        if (ROOM_LIST[i].id == url && ROOM_LIST[i].count < 4 && ROOM_LIST[i].hasStarted == false) {
            res.sendFile(__dirname + '/index.html');
            return;
        }
    }
    res.status(404).send('404: Room does not exist.');
});

var Player = function(id) {
    var self = {
        x : 125,
        y : 125,
        id : id,
        username : '',
        number : '' + Math.floor(10 * Math.random()),
        count : 0,
        color : '#FFFFFF',
        canMove : false,
        key : 'up',
        maxSpd : 1,
        room : 0,
    }
    self.updatePosition = function() {
        if (self.canMove == true) {
            if (self.key == 'right')
                self.x += self.maxSpd;
            if (self.key == 'left')
                self.x -= self.maxSpd;
            if (self.key == 'up')
                self.y -= self.maxSpd;
            if (self.key == 'down')
                self.y += self.maxSpd;
        }
    }
    return self;
}

var Room = function(id) {
    var self = {
        id : id,
        count : 0,
        winCount : 0,
        refresh : 0,
        hasStarted : false
    }
    return self;
}

var running = true;
var runtime = setInterval(function() {
    updatePos();
}, 1000/40);

io.on('connection', function(socket) {

    // actions for disconnection from a room
    socket.on('disconnect',function(){
        if (PLAYER_LIST[socket.id] != null) {
            var player = PLAYER_LIST[socket.id];
            for (var i = 0; i < ROOM_LIST.length; i++) {
                if (player.room == ROOM_LIST[i].id) {
                    ROOM_LIST[i].count--;
                    
                    if (ROOM_LIST[i].hasStarted) {
                        delete PLAYER_LIST[socket.id];
                        delete SOCKET_LIST[socket.id];
                        if (player.canMove && ROOM_LIST[i].winCount < 3)
                            ROOM_LIST[i].winCount++;
                        if (ROOM_LIST[i].winCount == 3) {
                            var winner = getWinner(ROOM_LIST[i]);
                            io.to(ROOM_LIST[i].id).emit('winner', {winner : winner.username, color : winner.color, count : ROOM_LIST[i].count});
                            running = false;
                            setTimeout(function(){ running = true; io.to(player.room).emit('clearCanvas', {}); }, 3000);
                            initPos(player);
                            ROOM_LIST[i].winCount = 4;
                        } else {
                            for (var j in PLAYER_LIST) {
                                if (PLAYER_LIST[j].room == player.room && player.count < PLAYER_LIST[j].count)
                                    PLAYER_LIST[j].count--;
                            }
                        }
                    } else {
                        if (ROOM_LIST[i].count == 0)
                            ROOM_LIST.splice(i, 1);
                        io.to(player.room).emit('clearCanvas', {});
                        delete PLAYER_LIST[socket.id];
                        delete SOCKET_LIST[socket.id];
                        initPos(player);
                    }
                    
                    io.to(player.room).emit('getUsers', {players : PLAYER_LIST});
                    break;
                }
            }
        }
    });
    
    // update rooms (for lobby)
    socket.emit('getRooms', {rooms : ROOM_LIST});
    socket.on('updateRooms', function(data) {
        socket.emit('getRooms', {rooms : ROOM_LIST});
    });
    
    // listen for player movement
    socket.on('keyPress', function(data) {
        var player = PLAYER_LIST[socket.id];
        if (player.canMove == true) {
            player.key = data.inputID;
        }
    });
    
    // create a room
    socket.on('creation', function(data) {
        var room = Room(data.ROOM_ID);
        ROOM_LIST.push(room);
    });
    
    // join a room
    socket.on('joinRoom', function(data) {
        SOCKET_LIST[socket.id] = socket;
        socket.join(data.ROOM_ID);
        var player = Player(socket.id);
        player.room = data.ROOM_ID;
        player.username = data.USER_ID;
        PLAYER_LIST[socket.id] = player;
        
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (ROOM_LIST[i].id == data.ROOM_ID) {
                ROOM_LIST[i].count++;
                player.count = ROOM_LIST[i].count;
                getPosInRoom(player);
                getColor(player);
                if (ROOM_LIST[i].count == 4) {
                    for (var j in PLAYER_LIST) {
                        if (PLAYER_LIST[j].room == data.ROOM_ID) {
                            PLAYER_LIST[j].canMove = true;
                        }
                    }
                    startGame(ROOM_LIST[i]);
                }
                break;
            }
        }
        io.to(player.room).emit('getUsers', {players : PLAYER_LIST});
    });
    
    // check if a room exists (for lobby)
    socket.on('checkRoom', function(data) {
        var exists = false;
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (ROOM_LIST[i].id == data.ROOM_ID && ROOM_LIST[i].count < 4) {
                exists = true;
                break;
            }
        }
        socket.emit('roomExists', {state : exists});
    });
    
    // actions on player collision/death
    socket.on('crash', function(data) {
        var player = PLAYER_LIST[data.player];
        if (player.canMove) {
            player.canMove = false;
            for (var i = 0; i < ROOM_LIST.length; i++) {
                if (player.room == ROOM_LIST[i].id) {
                    ROOM_LIST[i].winCount++;
                    if (ROOM_LIST[i].winCount == 3) {
                        var winner = getWinner(ROOM_LIST[i]);
                        io.to(ROOM_LIST[i].id).emit('winner', { winner : winner.username, color : winner.color, count : ROOM_LIST[i].count });
                        ROOM_LIST[i].winCount = 4;
                    }
                    break;
                }
            }
        }
    });
   
    // send messages
    socket.on('message', function(data) {
        io.to(data.ROOM_ID).emit('showMsg', {MESSAGE : data.MESSAGE, USER_ID: data.USER_ID});
    });
    
    // actions on clicking 'New Game' button
    socket.on('refresh', function(data) {
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (data.ROOM_ID == ROOM_LIST[i].id) {
                ROOM_LIST[i].refresh++;
                io.to(data.ROOM_ID).emit('updateRefresh', {count : ROOM_LIST[i].refresh});
                if (ROOM_LIST[i].refresh == 4)
                    socket.emit('newGame', {count : ROOM_LIST[i].refresh});
                break;
            }
        }
    });
    
    // reset the game
    socket.on('resetGame', function(data) {
        for (var i = 0; i < ROOM_LIST.length; i++) {
            if (data.ROOM_ID == ROOM_LIST[i].id) {
                ROOM_LIST[i].refresh = 0;
                ROOM_LIST[i].winCount = 0;
                io.to(data.ROOM_ID).emit('clearCanvas', {});
                
                if (ROOM_LIST[i].count == 4) {
                    for (var j in PLAYER_LIST) {
                        if (PLAYER_LIST[j].room == data.ROOM_ID) {
                            getPosInRoom(PLAYER_LIST[j]);
                            PLAYER_LIST[j].canMove = true;
                        }
                    }
                    startGame(ROOM_LIST[i]);
                } else {
                    for (var j in PLAYER_LIST) {
                        if (PLAYER_LIST[j].room == data.ROOM_ID) {
                            getPosInRoom(PLAYER_LIST[j]);
                            getColor(PLAYER_LIST[j]);
                        }
                    }
                    socket.emit('getUsers', {players : PLAYER_LIST});
                }
            }
        }
    });
})

function getColor(player) {
    var color = '#FFFFFF';
    if (player.count == 1) {
        color = '#FF0000';
    } else if (player.count == 2) {
        color = '#00FF00';
    } else if (player.count == 3) {
        color = '#0000FF';
    } else if (player.count == 4) {
        color = '#800080';
    }
    player.color = color;
    return;
}

function getPosInRoom(player) {
    if (player.count == 1) {
        player.x = 125;
        player.y = 125;
    } else if (player.count == 2) {
        player.x = 125;
        player.y = 375;
    } else if (player.count == 3) {
        player.x = 375;
        player.y = 125;
    } else if (player.count == 4) {
        player.x = 375;
        player.y = 375;
    }
    return;
}

function getWinner(room) {
    var winner;
    for (var i in PLAYER_LIST) {
        if (PLAYER_LIST[i].room == room.id && PLAYER_LIST[i].canMove) {
            winner = PLAYER_LIST[i];
            PLAYER_LIST[i].canMove = false;
        }
    }
    room.hasStarted = false;
    return winner;
}

function startGame(room) {
    updatePos();
    running = false;
    setTimeout(function(){ running = true; }, 5000);
    var countdown = 5;
    io.to(room.id).emit('countDown', {countdown : countdown});
    var timer = setInterval(function() {
        countdown--;
        if (countdown == 0) {
            clearInterval(timer);
        }
        io.to(room.id).emit('countDown', {countdown : countdown});
    }, 1000);
    room.hasStarted = true;
}

function initPos(player) {
    for (var i in PLAYER_LIST) {
        if (PLAYER_LIST[i].room == player.room && player.count < PLAYER_LIST[i].count) {
            PLAYER_LIST[i].count--;
            getPosInRoom(PLAYER_LIST[i]);
            getColor(PLAYER_LIST[i]);
        }
    }
}

function updatePos() {
    if (running) {
        var pack = [];
        for(var i in PLAYER_LIST) {
            var player = PLAYER_LIST[i];
            player.updatePosition();
            pack.push({
                x : player.x,
                y : player.y,
                color : player.color,
                room : player.room,
                key : player.key,
            });
        }
        for(var i in SOCKET_LIST) {
            var socket = SOCKET_LIST[i];
            socket.emit('collision', {player : PLAYER_LIST[socket.id]});
            socket.emit('newPositions', pack);
        }
    }    
}

http.listen(app.get('port'), function(){
    console.log('Server running...');
});