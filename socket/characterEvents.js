var log = require('lib/log')(module);
var async = require('async');
var User = require('models/user').User;
var Team = require('models/team').Team;
var Character = require('models/character').Character;

module.exports = function (serverIO) {
    var io = serverIO;
    io.on('connection', function (socket) {

        socket.on('createChar', function(){
            var userId = socket.handshake.user._id;
            Team.getByAny({teamName: "newTeam_"+userId}, function(err, team){
                if(err) socket.emit("customError", err);
                if(team!=null){
                    Character.create(team._id, function(err, char){
                        if (err) socket.emit("customError", err);
                        if(char) socket.emit("createCharResult");
                        else log.error("Can't create character");
                    });
                }
                else {
                    socket.emit("customError", "Team not found");
                }
            });
        });

        socket.on('removeChar', function(teamId, charId){
            //������ ������ ��������� � �������
            Team.findByIdAndUpdate(teamId, {$pull: {characters: charId}}, function(err, team){
                if(err) socket.emit("customError", err);
                //� ����� ������ � ��� ������
                Character.deleteById(charId, function(err){
                    if (err) socket.emit("customError", err);
                    socket.emit("removeCharResult");
                });
            });
        });

        socket.on('getChar', function(cond){
            Character.getByAny(cond, function(err, char){
                if (err) socket.emit("customError", err);
                if(char) socket.emit("getCharResult", char);
                else socket.emit("getCharResult");
            });
        });

        socket.on('getDummyChar', function(){
            var userId = socket.handshake.user._id;
            Team.findOne({teamName: "newTeam_"+userId}, function(err, team){
                if(err) socket.emit("customError", err);
                Character.getByAny({charName: "newChar_"+team._id}, function(err, char){
                    if (err) socket.emit("customError", err);
                    if(char){
                        char.populate('_team', function(err, popChar) {
                            if (err) socket.emit("customError", err);
                            socket.emit("getDummyCharResult", popChar);
                        });
                    }
                    else {
                        log.error("Can't populate null dummy character.");
                        if(userId) { log.error("userId: "+userId)};
                        if(team) { log.error("newChar: newChar_"+team._id)};
                    }
                });
            });
        });

        socket.on('setChar', function(cond){
            Character.setById(cond._id, cond, function(err, char){
                if (err) socket.emit("customError", err);
                socket.emit("setCharResult");
            });
        });

    });
};
